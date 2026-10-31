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

    def find_one(self, _filter):
        return None

    def insert_one(self, document):
        self.inserted.append(document)
        return SimpleNamespace(inserted_id="0123456789abcdef01234567")

    def update_one(self, _filter, _update):
        pass


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
