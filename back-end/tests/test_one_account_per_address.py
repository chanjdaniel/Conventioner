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
from html.parser import HTMLParser
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
        self.deleted = []
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
        self.deleted.append(query)
        return SimpleNamespace(deleted_count=0)


def _words(html: str) -> list:
    """The words an HTML email reads as, its tags left out."""
    words = []
    parser = HTMLParser()
    parser.handle_data = lambda data: words.extend(data.split())
    parser.feed(html)
    return words


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


#: What every sign-up the checks pass answers, whether or not the address has an account.
SIGNED_UP = (201, {
    "msg": "User registered successfully. Please check your email to verify your account."
})


class TestRegistering:
    """A sign-up answers alike whether or not its address has an account.

    The same checks run in the same order and the password is hashed either way; a new address is
    sent its verification link, and an address with an account is sent one email saying it has one,
    with nothing about that account changed.
    """

    @pytest.fixture
    def register(self, monkeypatch):
        sent = SimpleNamespace(verification=[], account_exists=[])
        hashed = []
        monkeypatch.setattr(UsersApi, "verify_recaptcha", lambda *_a: (True, 0.9))
        monkeypatch.setattr(UsersApi, "send_verification_email",
                            lambda email, _t: sent.verification.append(email) or True)
        monkeypatch.setattr(UsersApi, "send_account_exists_email",
                            lambda email: sent.account_exists.append(email) or True)
        bcrypt = SimpleNamespace(generate_password_hash=lambda p: hashed.append(p) or b"hashed")

        def _register(email, password="longenough"):
            from flask import Flask
            app = Flask(__name__)
            with app.test_request_context(
                "/register", method="POST",
                json={"email": email, "password": password, "captcha_token": "t"},
            ):
                response, status = UsersApi.register_user_with_captcha(bcrypt)
                return status, response.get_json()
        _register.sent = sent
        _register.hashed = hashed
        return _register

    @pytest.fixture
    def taken(self, users):
        """An address with a verified account, every field an account holds set."""
        collection = users("dan@example.com")
        collection.docs[0].update({
            "password": "the-accounts-own-hash", "email_verified": True, "organizations": ["org-1"],
            "verification_token": None, "password_reset_token": None, "otp": None,
            "login_id": "the-accounts-login-id",
        })
        collection.before = [dict(doc) for doc in collection.docs]
        return collection

    def test_an_address_is_stored_lowercased(self, users, register):
        collection = users()

        status, _body = register("  Dan@Example.com")

        assert status == 201
        assert collection.inserted[0]["email"] == "dan@example.com"
        assert register.sent.verification == ["dan@example.com"]

    def test_a_taken_address_answers_as_a_new_one_does(self, users, taken, register):
        assert register("dan@example.com") == SIGNED_UP
        assert register("new@example.com") == SIGNED_UP

    def test_a_taken_address_is_sent_one_email_saying_it_has_an_account(
        self, taken, register,
    ):
        register("dan@example.com")

        assert register.sent.account_exists == ["dan@example.com"]
        assert register.sent.verification == []

    def test_a_taken_address_changes_nothing_on_its_account(self, taken, register):
        register("dan@example.com")

        assert taken.docs == taken.before
        assert taken.inserted == []
        assert taken.deleted == []

    def test_a_taken_address_hashes_the_password_as_a_new_one_does(
        self, users, taken, register,
    ):
        register("dan@example.com")
        register("new@example.com")

        assert register.hashed == ["longenough", "longenough"]

    def test_another_spelling_of_an_address_is_the_same_account(self, taken, register):
        assert register("DAN@example.com") == SIGNED_UP
        assert register.sent.account_exists == ["dan@example.com"]
        assert taken.inserted == []

    @pytest.mark.parametrize("password, refused", [
        ("short", "Password must be at least 8 characters long"),
        ("x" * 73, UsersApi.PASSWORD_TOO_LONG),
    ], ids=["too-short", "too-long"])
    def test_a_taken_address_with_a_refused_password_is_refused_as_a_new_one_is(
        self, users, taken, register, password, refused,
    ):
        assert register("dan@example.com", password) == (400, {"msg": refused})
        assert register("new@example.com", password) == (400, {"msg": refused})
        assert (register.sent.account_exists, register.sent.verification) == ([], [])
        assert register.hashed == []

    def test_a_taken_address_with_a_malformed_spelling_is_refused_as_a_new_one_is(
        self, users, register,
    ):
        users("dan@example")

        assert register("dan@example") == (400, {"msg": "Invalid email format"})
        assert register("new@example") == (400, {"msg": "Invalid email format"})
        assert register.sent.account_exists == []

    def test_a_failed_send_answers_alike_for_a_taken_address(
        self, users, taken, register, monkeypatch,
    ):
        monkeypatch.setattr(UsersApi, "send_account_exists_email", lambda _email: False)
        monkeypatch.setattr(UsersApi, "send_verification_email", lambda _email, _t: False)

        taken_answer = register("dan@example.com")
        new_answer = register("new@example.com")

        assert taken_answer == new_answer
        assert taken_answer[0] == 500
        assert taken.docs[:1] == taken.before, "the account is left as it was"

    def test_a_second_request_the_check_missed_answers_as_a_new_one_does(
        self, users, taken, register, monkeypatch,
    ):
        """The race: both requests read no account, and the index refuses the second insert."""
        monkeypatch.setattr(taken, "find_one", lambda _q: None)

        assert register("dan@example.com") == SIGNED_UP
        assert register.sent.account_exists == ["dan@example.com"]
        assert register.sent.verification == []
        assert taken.docs == taken.before

    def test_a_failed_send_after_the_race_answers_as_a_new_one_does(
        self, users, taken, register, monkeypatch,
    ):
        monkeypatch.setattr(taken, "find_one", lambda _q: None)
        monkeypatch.setattr(UsersApi, "send_account_exists_email", lambda _email: False)
        monkeypatch.setattr(UsersApi, "send_verification_email", lambda _email, _t: False)

        raced = register("dan@example.com")
        new = register("new@example.com")

        assert raced == new
        assert raced[0] == 500
        assert taken.docs[:1] == taken.before


class TestTheAccountExistsEmail:
    """The one email a sign-up for a taken address sends: it has an account, and the way back in."""

    @pytest.fixture
    def sent(self, monkeypatch):
        import utils.email as email_mod

        sent = []
        monkeypatch.setenv("FRONTEND_URL", "https://app.example.com")
        monkeypatch.setattr(email_mod, "_send", lambda *args: sent.append(args) or True)
        assert email_mod.send_account_exists_email("dan@example.com") is True
        [message] = sent
        return dict(zip(("kind", "to", "subject", "html", "text"), message))

    def test_it_goes_to_the_address_with_its_subject(self, sent):
        assert sent["to"] == "dan@example.com"
        assert sent["subject"] == "You already have a Conventioner account"

    @pytest.mark.parametrize("part", ["html", "text"])
    def test_each_part_says_it_all_with_both_links(self, sent, part):
        body = " ".join(_words(sent[part]) if part == "html" else sent[part].split())

        for words in (
            "Someone, maybe you, tried to create a Conventioner account with this email address.",
            "You already have one.",
            "Sign in: https://app.example.com/login",
            "Forgot your password? Reset it: https://app.example.com/reset-password-request",
            "If this wasn't you, you can ignore this email: nothing about your account has changed.",
        ):
            assert words in body

    def test_its_links_are_the_sign_in_and_reset_pages(self, sent):
        assert 'href="https://app.example.com/login"' in sent["html"]
        assert 'href="https://app.example.com/reset-password-request"' in sent["html"]


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
