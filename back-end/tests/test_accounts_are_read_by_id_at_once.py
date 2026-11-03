"""Every account a read names is read in one database read (T204).

The market read looked up each person it named by id, one database read each, on every market read
every screen makes: an organization of 150 members cost 150 reads. ``get_users_by_ids`` reads them
all with one ``find`` over the indexed ``id``, answering the accounts it found by id.
"""
import pytest

from conftest import mongo_matches
import api.users as UsersApi


class _Users:
    """The users collection, counting its reads."""

    def __init__(self, documents):
        self.documents = documents
        self.finds = []

    def find(self, query, projection=None):
        self.finds.append(query)
        return iter([dict(doc) for doc in self.documents if mongo_matches(doc, query)])

    def find_one(self, query):
        raise AssertionError(f"one account read alone: {query}")


def _account(user_id, email):
    return {"_id": f"mongo-{user_id}", "id": user_id, "email": email, "password": "hash",
            "organizations": [], "markets": [], "email_verified": True}


@pytest.fixture
def users(monkeypatch):
    collection = _Users([
        _account("user-1", "one@example.com"),
        _account("user-2", "two@example.com"),
        _account("user-3", "three@example.com"),
    ])
    monkeypatch.setattr(UsersApi, "users_collection", collection)
    return collection


def test_the_accounts_are_answered_by_id_from_one_read(users):
    found = UsersApi.get_users_by_ids(["user-1", "user-3"])

    assert {user_id: account.email for user_id, account in found.items()} == {
        "user-1": "one@example.com", "user-3": "three@example.com"}
    assert all(isinstance(account, UsersApi.AuthUser) for account in found.values())
    assert users.finds == [{"id": {"$in": ["user-1", "user-3"]}}]


def test_an_id_with_no_account_is_left_out(users):
    found = UsersApi.get_users_by_ids(["user-2", "user-gone"])

    assert list(found) == ["user-2"]
    assert len(users.finds) == 1


def test_an_id_named_twice_is_asked_once(users):
    UsersApi.get_users_by_ids(["user-1", "user-1", "user-2"])

    assert users.finds == [{"id": {"$in": ["user-1", "user-2"]}}]


@pytest.mark.parametrize("ids", [[], (), iter([])])
def test_no_ids_read_nothing(users, ids):
    assert UsersApi.get_users_by_ids(ids) == {}
    assert users.finds == []


def test_the_answer_is_the_account_get_user_by_id_answers(users, monkeypatch):
    """One account, two ways to read it: the batch answers what the one-id read does."""
    monkeypatch.setattr(users, "find_one", lambda query: next(
        (dict(doc) for doc in users.documents if mongo_matches(doc, query)), None))

    batch = UsersApi.get_users_by_ids(["user-2"])["user-2"]
    alone = UsersApi.get_user_by_id("user-2")

    assert vars(batch) == vars(alone)

