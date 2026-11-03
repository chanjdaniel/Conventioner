"""The fixture account script writes only to a database the environment names.

Unnamed, the client falls back to 127.0.0.1:27017, which on a developer's machine is the primary
checkout's stack, so a run on the host meant for another stack would seed the primary one.
"""
from types import SimpleNamespace

import pytest

import create_test_user as Script


class _Users:
    def __init__(self):
        self.inserted = []

    def find_one(self, query):
        return next((doc for doc in self.inserted if doc["email"] == query["email"]), None)

    def insert_one(self, document):
        self.inserted.append(document)
        document["_id"] = f"{len(self.inserted):024x}"
        return SimpleNamespace(inserted_id=document["_id"])

    def update_one(self, query, update):
        for doc in self.inserted:
            if doc["_id"] == query["_id"]:
                doc.update(update["$set"])


def _database(monkeypatch):
    users = _Users()
    monkeypatch.setattr(Script, "get_database", lambda: {"users": users})
    return users


def test_a_database_the_environment_does_not_name_gets_no_account(monkeypatch):
    users = _database(monkeypatch)
    monkeypatch.delenv("MONGODB_URI", raising=False)
    monkeypatch.delenv("MONGODB_HOST", raising=False)

    with pytest.raises(SystemExit) as refused:
        Script.create_test_user("e2e@example.com", "e2epassword123")
    assert "MONGODB_HOST" in str(refused.value)
    assert users.inserted == []


def test_the_primary_stack_s_database_gets_no_account_from_a_stale_host(monkeypatch):
    users = _database(monkeypatch)
    for name in ("MONGODB_URI", "ALLOW_PRIMARY_STACK"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MONGODB_HOST", "localhost")
    monkeypatch.setenv("MONGODB_PORT", "27017")

    with pytest.raises(SystemExit) as refused:
        Script.create_test_user("e2e@example.com", "e2epassword123")
    assert "primary checkout's stack" in str(refused.value)
    assert users.inserted == []


def test_the_named_stack_gets_a_verified_account(monkeypatch):
    users = _database(monkeypatch)
    monkeypatch.delenv("MONGODB_URI", raising=False)
    # As every stack's back-end container sets it.
    monkeypatch.setenv("MONGODB_HOST", "mongodb")

    assert Script.create_test_user("e2e@example.com", "e2epassword123")
    assert [(user["email"], user["email_verified"]) for user in users.inserted] == [("e2e@example.com", True)]


def _named_stack(monkeypatch):
    users = _database(monkeypatch)
    monkeypatch.delenv("MONGODB_URI", raising=False)
    monkeypatch.setenv("MONGODB_HOST", "mongodb")
    return users


@pytest.fixture
def hashes(monkeypatch):
    """How many times a password was hashed: bcrypt is slow by design, so a bulk run hashes once."""
    made = []
    real = Script.Bcrypt.generate_password_hash

    def counted(self, password, *args):
        made.append(password)
        return real(self, password, *args)

    monkeypatch.setattr(Script.Bcrypt, "generate_password_hash", counted)
    return made


def test_the_bulk_form_makes_each_address_a_verified_account_hashing_once(monkeypatch, hashes):
    """``--bulk`` (T204) makes 150 fixture accounts in one process, as the one-address form makes
    one: stored lowercased, verified, its id its Mongo id."""
    users = _named_stack(monkeypatch)

    made = Script.create_test_users(["Person-001@People.test", "person-002@people.test"], "pw-123")

    assert [(u["email"], u["email_verified"], u["id"] == u["_id"]) for u in users.inserted] == [
        ("person-001@people.test", True, True), ("person-002@people.test", True, True)]
    assert made == {u["email"]: u["id"] for u in users.inserted}
    assert hashes == ["pw-123"]
    assert len({u["password"] for u in users.inserted}) == 1


def test_the_bulk_form_leaves_an_address_already_made_as_it_is(monkeypatch, hashes):
    users = _named_stack(monkeypatch)
    Script.create_test_users(["person-001@people.test"], "pw-123")
    first = dict(users.inserted[0])

    made = Script.create_test_users(["person-001@people.test", "person-002@people.test"], "pw-456")

    assert [u["email"] for u in users.inserted] == [
        "person-001@people.test", "person-002@people.test"]
    assert users.inserted[0] == first
    assert made == {u["email"]: u["id"] for u in users.inserted}


def test_the_bulk_form_names_every_account_it_answers(monkeypatch, capsys, hashes):
    """Made or found, each address's line carries its id, which the seed reads."""
    users = _named_stack(monkeypatch)
    Script.create_test_users(["person-001@people.test"], "pw-123")
    capsys.readouterr()

    Script.main(["--bulk", "pw-123", "person-001@people.test", "person-002@people.test"])

    printed = capsys.readouterr().out.splitlines()
    ids = {u["email"]: u["id"] for u in users.inserted}
    assert printed == [
        f"exists person-001@people.test {ids['person-001@people.test']}",
        f"created person-002@people.test {ids['person-002@people.test']}",
    ]


def test_the_bulk_form_refuses_a_database_the_environment_does_not_name(monkeypatch, hashes):
    users = _database(monkeypatch)
    monkeypatch.delenv("MONGODB_URI", raising=False)
    monkeypatch.delenv("MONGODB_HOST", raising=False)

    with pytest.raises(SystemExit):
        Script.main(["--bulk", "pw-123", "person-001@people.test"])
    assert users.inserted == []
    assert hashes == []


@pytest.mark.parametrize("argv", [["--bulk"], ["--bulk", "pw-123"], ["e2e@example.com"]])
def test_a_command_missing_its_values_says_how_to_run_it(monkeypatch, capsys, argv):
    users = _named_stack(monkeypatch)

    with pytest.raises(SystemExit) as refused:
        Script.main(argv)
    assert refused.value.code == 1
    assert "Usage" in capsys.readouterr().out
    assert users.inserted == []


def test_the_one_address_form_is_unchanged(monkeypatch, capsys, hashes):
    users = _named_stack(monkeypatch)

    Script.main(["E2E@example.com", "e2epassword123"])

    assert [u["email"] for u in users.inserted] == ["e2e@example.com"]
    out = capsys.readouterr().out
    assert "Successfully created test user" in out
    assert "e2epassword123" in out
