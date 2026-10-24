"""One address is one account (E32/F03/S04).

Production sent one address two "Verify your email address" emails 150 ms apart, and a double click
on Register reproduced it: two accounts for one address. Register checked for the address and then
inserted it, two steps a second request could fall between, and nothing in the database forbade a
second document - the email index was not unique. It is now, built at boot like the applications'
identity index, so the database is the referee; and every address is stored and looked up lowercased,
so "Dan@example.com" and "dan@example.com" are one account, as `create_account.py` already stored them.
"""
import os
import sys
from types import SimpleNamespace

import pytest
from pymongo.errors import DuplicateKeyError, PyMongoError

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.users as UsersApi  # noqa: E402
from utils.email_address import normalized_email  # noqa: E402


class FakeUsers:
    """Users with the email index as the database would hold it, unique or not."""

    def __init__(self, *emails, unique=False):
        self.docs = [{"id": f"id-{i}", "email": e} for i, e in enumerate(emails)]
        self.indexes = {"_id_": {"key": [("_id", 1)]}}
        if emails or not unique:
            self.indexes["email_1"] = {"key": [("email", 1)]}
        self.unique = unique
        self.inserted = []
        self.scanned = False

    def index_information(self):
        return {name: dict(info) for name, info in self.indexes.items()}

    def drop_index(self, name):
        self.indexes.pop(name)

    def create_index(self, keys, unique=False, name=None):
        emails = [d["email"] for d in self.docs]
        if unique and len(set(emails)) < len(emails):
            shared = next(e for e in emails if emails.count(e) > 1)
            # As MongoDB words it: the duplicate key quotes the address.
            raise PyMongoError(f'E11000 duplicate key error index: user_email dup key: {{ email: "{shared}" }}')
        self.indexes[name] = {"key": list(keys), "unique": unique}
        self.unique = self.unique or unique
        return name

    def find(self, query=None, projection=None):
        self.scanned = True
        return [dict(d) for d in self.docs]

    def find_one(self, query):
        return next((dict(d) for d in self.docs if d["email"] == query.get("email")), None)

    def insert_one(self, doc):
        if self.unique and any(d["email"] == doc["email"] for d in self.docs):
            raise DuplicateKeyError("E11000 duplicate key error collection: users index: user_email")
        self.docs.append(dict(doc))
        self.inserted.append(doc)
        return SimpleNamespace(inserted_id=len(self.docs))

    def delete_one(self, query):
        return SimpleNamespace(deleted_count=0)


@pytest.fixture
def users(monkeypatch):
    def _install(*emails, unique=True):
        collection = FakeUsers(*emails, unique=unique)
        monkeypatch.setattr(UsersApi, "users_collection", collection)
        return collection
    return _install


class TestAnAddressIsStoredOneWay:
    def test_an_address_is_trimmed_and_lowercased(self):
        assert normalized_email("  Dan@Example.COM ") == "dan@example.com"
        assert normalized_email(None) == ""


class TestRegistering:
    @pytest.fixture
    def register(self, monkeypatch):
        sent = []
        monkeypatch.setattr(UsersApi, "verify_recaptcha", lambda *_a: (True, 0.9))
        monkeypatch.setattr(UsersApi, "send_verification_email", lambda email, _t: sent.append(email) or True)
        bcrypt = SimpleNamespace(generate_password_hash=lambda p: b"hashed")

        def _register(email):
            from flask import Flask
            app = Flask(__name__)
            with app.test_request_context(
                "/register", method="POST",
                json={"email": email, "password": "longenough", "captcha_token": "t"},
            ):
                response, status = UsersApi.register_user_with_captcha(bcrypt, __import__("flask").request)
                return response.get_json(), status
        _register.sent = sent
        return _register

    def test_an_address_is_stored_lowercased(self, users, register):
        collection = users()

        _body, status = register("  Dan@Example.com")

        assert status == 201
        assert collection.inserted[0]["email"] == "dan@example.com"
        assert register.sent == ["dan@example.com"]

    def test_a_second_request_the_check_missed_is_refused_by_the_index(self, users, register, monkeypatch):
        """The race: both requests read no account, and the index refuses the second insert."""
        collection = users("dan@example.com")
        monkeypatch.setattr(collection, "find_one", lambda _q: None)

        body, status = register("dan@example.com")

        assert status == 400
        assert body["msg"] == "User already exists"
        assert register.sent == []

    def test_another_spelling_of_an_address_is_the_same_account(self, users, register):
        users("dan@example.com")

        body, status = register("DAN@example.com")

        assert (status, body["msg"]) == (400, "User already exists")


class TestTheIndexIsTheReferee:
    def test_boot_builds_a_unique_index_on_the_address(self, users):
        collection = users("a@example.com", unique=False)

        UsersApi.ensure_user_indexes()

        assert collection.indexes[UsersApi.USER_EMAIL_INDEX] == {
            "key": [("email", 1)], "unique": True,
        }
        assert "email_1" not in collection.indexes, "the plain index on the same key is replaced"

    def test_duplicates_refuse_the_boot_and_are_named(self, users):
        users("a@example.com", "a@example.com", unique=False)

        with pytest.raises(UsersApi.UserIndexError) as refused:
            UsersApi.ensure_user_indexes()

        assert "id-0, id-1" in str(refused.value)
        assert "a@example.com" not in str(refused.value), "ids, never addresses, reach the logs"

    def test_a_boot_after_the_index_stands_reads_no_account(self, users):
        """Every cold start on a serverless host is a boot; the index is the referee by then."""
        collection = users("a@example.com", unique=False)
        UsersApi.ensure_user_indexes()
        collection.scanned = False

        UsersApi.ensure_user_indexes()

        assert collection.scanned is False

    def test_the_index_has_one_owner(self):
        from lookup_indexes import LOOKUP_INDEXES

        assert ("email",) not in LOOKUP_INDEXES["users"], "api.users builds it, unique"

    def test_an_address_not_stored_lowercased_refuses_and_names_the_migration(self, users):
        users("Dan@example.com", unique=False)

        with pytest.raises(UsersApi.UserIndexError) as refused:
            UsersApi.ensure_user_indexes()

        assert "migrations/migrate_user_emails.py" in str(refused.value)
        assert "id-0" in str(refused.value)
        assert "Dan@example.com" not in str(refused.value)


class TestTheMigration:
    def test_it_lowercases_every_address(self):
        import migrations.migrate_user_emails as migration

        collection = FakeUsers("Dan@Example.com", "lee@example.com")
        updates = []
        collection.update_one = lambda q, u: updates.append((q, u))

        migration.lowercase_user_emails(collection)

        assert updates == [({"id": "id-0"}, {"$set": {"email": "dan@example.com"}})]

    def test_it_stops_and_names_addresses_that_would_collide(self):
        import migrations.migrate_user_emails as migration

        collection = FakeUsers("Dan@example.com", "dan@example.com")
        collection.update_one = lambda q, u: pytest.fail("nothing is written when a clash is found")

        with pytest.raises(migration.UserEmailCollisionError) as refused:
            migration.lowercase_user_emails(collection)

        assert "id-0, id-1" in str(refused.value)
        assert "example.com" not in str(refused.value)
