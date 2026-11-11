"""Today's writers of an organization's people keep its people map in step (T283).

A new organization is created with its map, and every reader prefers the map, so "Add admin",
"Add member", "Remove", a transfer and an account's deletion write the map as well as the lists
they always wrote: a person added is a person listed. An organization stored before the map has
none, and is read, and written, by its lists alone. T283's ticket 02 replaces these writes with one
conditional write each, in ``organization_people``.
"""
import copy
from types import SimpleNamespace

import pytest

from conftest import mongo_matches, mongo_update, sessions_load_through_get_user
import app as app_module
import api.organizations as OrgsApi
import api.users as UsersApi
import history as History
from datatypes import Organization

OWNER = SimpleNamespace(id="user-owner", email="owner@example.com")
ADA = SimpleNamespace(id="user-ada", email="ada@example.com")
BEA = SimpleNamespace(id="user-bea", email="bea@example.com")
PEOPLE = (OWNER, ADA, BEA)


class Organizations:
    """The organizations collection, filtered and written as the server does."""

    def __init__(self, *docs):
        self.docs = [copy.deepcopy(doc) for doc in docs]

    def find_one(self, query, projection=None):
        return next((copy.deepcopy(doc) for doc in self.docs if mongo_matches(doc, query)), None)

    def find(self, query, projection=None):
        return [copy.deepcopy(doc) for doc in self.docs if mongo_matches(doc, query)]

    def insert_one(self, doc):
        self.docs.append({**copy.deepcopy(doc), "_id": f"mongo-{doc['id']}"})

    def update_one(self, query, update):
        return self.update_many(query, update, first=True)

    def update_many(self, query, update, first=False):
        matched = modified = 0
        for index, doc in enumerate(self.docs):
            if not mongo_matches(doc, query):
                continue
            after = mongo_update(doc, update)
            matched += 1
            modified += after != doc
            self.docs[index] = after
            if first:
                break
        return SimpleNamespace(matched_count=matched, modified_count=modified)


class Accounts:
    """The users collection, enough for the account copy and the deletion."""

    def __init__(self):
        self.docs = [{"id": person.id, "email": person.email, "organizations": []}
                     for person in PEOPLE]

    def update_one(self, *_args, **_kwargs):
        return SimpleNamespace(modified_count=1)

    def update_many(self, *_args, **_kwargs):
        return SimpleNamespace(modified_count=1)

    def find_one(self, query, projection=None):
        return next((dict(doc) for doc in self.docs if mongo_matches(doc, query)), None)

    def delete_one(self, query):
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not mongo_matches(doc, query)]
        return SimpleNamespace(deleted_count=before - len(self.docs))


@pytest.fixture
def stored(monkeypatch):
    organizations = Organizations()
    by_email = {person.email: person for person in PEOPLE}
    by_id = {person.id: person for person in PEOPLE}
    monkeypatch.setattr(OrgsApi, "organizations_collection", organizations)
    monkeypatch.setattr(OrgsApi, "users_collection", Accounts())
    monkeypatch.setattr(OrgsApi, "markets_collection", SimpleNamespace(find=lambda *_a: []))
    monkeypatch.setattr(UsersApi, "get_user", by_email.get)
    monkeypatch.setattr(UsersApi, "get_user_by_id", by_id.get)
    monkeypatch.setattr(UsersApi, "get_users_by_ids",
                        lambda ids: {i: by_id[i] for i in ids if i in by_id})
    monkeypatch.setattr(History, "record_for_organization", lambda *_a, **_k: None)
    return organizations


def the_only(organizations):
    [doc] = organizations.docs
    return doc


def places(doc):
    """The document's people as the model reads them, and its lists as stored."""
    model = Organization(**{key: value for key, value in doc.items() if key != "_id"})
    return model.people, (doc["owner"], doc["admins"], doc["members"])


def test_each_writer_keeps_a_new_organizations_map_and_lists_alike(stored):
    org_id = OrgsApi.create_organization(OWNER.email, "Ember Markets")
    assert the_only(stored)["people"] == {OWNER.id: "owner"}

    OrgsApi.add_org_member(org_id, ADA.email, OWNER.email)
    OrgsApi.add_org_member(org_id, BEA.email, OWNER.email)
    assert places(the_only(stored))[0] == {OWNER.id: "owner", ADA.id: "member", BEA.id: "member"}

    OrgsApi.add_org_admin(org_id, ADA.email, OWNER.email)
    assert places(the_only(stored))[0] == {OWNER.id: "owner", ADA.id: "admin", BEA.id: "member"}

    OrgsApi.remove_org_user(org_id, BEA.id, OWNER.email)
    assert places(the_only(stored))[0] == {OWNER.id: "owner", ADA.id: "admin"}

    OrgsApi.transfer_org_ownership(org_id, OWNER.email, ADA.email)
    people, lists = places(the_only(stored))
    assert people == {OWNER.id: "admin", ADA.id: "owner"}
    assert lists == (ADA.id, [OWNER.id], [])

    [listed] = OrgsApi.get_organizations_for_user(OWNER.email)
    assert (listed["owner"], listed["admins"], listed["members"]) == (ADA.id, [OWNER.id], [])


def test_an_organization_stored_before_the_map_is_written_by_its_lists_alone(stored):
    stored.docs.append({"_id": "mongo-org-1", "id": "org-1", "name": "Ember Markets",
                        "owner": OWNER.id, "admins": [], "members": [], "markets": []})

    OrgsApi.add_org_member("org-1", ADA.email, OWNER.email)
    OrgsApi.add_org_admin("org-1", BEA.email, OWNER.email)
    OrgsApi.remove_org_user("org-1", ADA.id, OWNER.email)

    doc = the_only(stored)
    assert "people" not in doc
    assert places(doc)[0] == {OWNER.id: "owner", BEA.id: "admin"}


def test_a_deleted_account_leaves_every_people_map(stored, monkeypatch):
    org_id = OrgsApi.create_organization(OWNER.email, "Ember Markets")
    OrgsApi.add_org_member(org_id, ADA.email, OWNER.email)
    accounts = Accounts()
    monkeypatch.setattr(UsersApi, "users_collection", accounts)
    monkeypatch.setattr(UsersApi, "get_user", lambda email: SimpleNamespace(
        id=ADA.id, email=email, is_active=True, is_authenticated=True, is_anonymous=False,
        get_id=lambda: email) if email == ADA.email else None)
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = ADA.email
        session["_fresh"] = True

    response = client.post("/delete-user", json={"email": ADA.email})

    assert response.status_code == 200
    assert places(the_only(stored)) == ({OWNER.id: "owner"}, (OWNER.id, [], []))
