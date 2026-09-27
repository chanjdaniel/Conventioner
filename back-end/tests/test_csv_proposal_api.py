"""``POST /markets/<id>/csv-proposal`` through the Flask test client (E24/F02/S01).

The proposal is read-only by contract: the file is read and let go, and nothing about the market
changes. The route is where that promise is kept or broken, so it is asserted here.
"""
import os
import sys
from types import SimpleNamespace

import pytest

from conftest import skip_without_real_dependencies

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.markets as MarketsApi
import api.users as UsersApi

OWNER_EMAIL = "owner@example.com"
OWNER_ID = "user-1"
STRANGER_EMAIL = "stranger@example.com"

CSV = "Timestamp,Email Address,Full Name\n" + "".join(
    f"1/{day}/2026 9:00:00,p{day}@mail.test,Wren Okafor{day}\n" for day in range(1, 6))


def _field(doc, dotted):
    for part in dotted.split("."):
        if not isinstance(doc, dict) or part not in doc:
            return _MISSING
        doc = doc[part]
    return doc


_MISSING = object()


def _matches(doc, query):
    """The Mongo filter operators the proposal's routes use: equality, $or, $exists, $size."""
    for key, expected in query.items():
        if key == "$or":
            if not any(_matches(doc, branch) for branch in expected):
                return False
            continue
        if key == "$and":
            if not all(_matches(doc, branch) for branch in expected):
                return False
            continue
        value = _field(doc, key)
        if isinstance(expected, dict) and "$exists" in expected:
            if (value is not _MISSING) != expected["$exists"]:
                return False
        elif isinstance(expected, dict) and "$size" in expected:
            if not isinstance(value, list) or len(value) != expected["$size"]:
                return False
        elif (None if value is _MISSING else value) != expected:
            return False
    return True


class FakeMarketsCollection:
    def __init__(self, doc):
        self.doc = doc
        self.writes = []

    def find_one(self, query):
        return dict(self.doc) if _matches(self.doc, query) else None

    def update_one(self, query, update, **kwargs):
        self.writes.append((query, update))
        if not _matches(self.doc, query):
            return SimpleNamespace(matched_count=0, modified_count=0)
        self.doc.update(update.get("$set", {}))
        return SimpleNamespace(matched_count=1, modified_count=1)

    def replace_one(self, *args, **kwargs):
        self.writes.append(args)


def _market(phase="draft", fields=None):
    return {
        "_id": "stored-1", "id": "market-1", "name": "Test Market", "creationDate": "2026-01-01",
        "roles": {OWNER_ID: "owner"}, "modificationList": [], "assignmentObject": {},
        "isDraft": phase == "draft", "phase": phase,
        "applicationForm": {"fields": fields or []},
    }


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    users = {OWNER_EMAIL: OWNER_ID, STRANGER_EMAIL: "user-2"}
    monkeypatch.setattr(
        UsersApi, "get_user",
        lambda email: SimpleNamespace(
            id=users[email], email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        ) if email in users else None,
    )
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER_EMAIL
        session["_fresh"] = True
    return client


@pytest.fixture
def markets(monkeypatch):
    def _install(doc):
        collection = FakeMarketsCollection(doc)
        monkeypatch.setattr(MarketsApi, "markets_collection", collection)
        return collection
    return _install


def test_a_draft_gets_its_proposal_and_nothing_is_written(client, markets):
    collection = markets(_market())
    before = dict(collection.doc)

    response = client.post("/markets/market-1/csv-proposal", json={"csvContent": CSV})

    assert response.status_code == 200, response.get_json()
    fates = [column["fate"] for column in response.get_json()["columns"]]
    assert fates == ["submitted_at", "applicant_email", "essential"]
    assert collection.writes == []
    assert collection.doc == before


def test_a_market_past_draft_is_refused(client, markets):
    markets(_market(phase="applications_open"))
    response = client.post("/markets/market-1/csv-proposal", json={"csvContent": CSV})
    assert response.status_code == 409
    assert "draft" in response.get_json()["error"]


def test_someone_without_a_role_on_the_market_is_refused(client, markets):
    markets(_market())
    with client.session_transaction() as session:
        session["_user_id"] = STRANGER_EMAIL
    response = client.post("/markets/market-1/csv-proposal", json={"csvContent": CSV})
    assert response.status_code == 403


def test_a_body_without_the_file_is_a_bad_request(client, markets):
    markets(_market())
    response = client.post("/markets/market-1/csv-proposal", json={})
    assert response.status_code == 400


def test_confirm_writes_the_form_the_plan_and_the_mapping_in_one_update(client, markets):
    collection = markets(_market())
    response = client.post("/markets/market-1/csv-proposal/confirm",
                           json={"csvContent": CSV, "year": 2026})
    assert response.status_code == 200, response.get_json()
    assert len(collection.writes) == 1
    assert collection.doc["importMapping"]["targets"]["applicant_email"] == ["Email Address"]
    assert "setupObject" in collection.doc and "applicationForm" in collection.doc


def test_confirm_on_a_market_that_gained_questions_writes_nothing(client, markets):
    collection = markets(_market(fields=[{"key": "shop", "label": "Shop", "type": "text"}]))
    before = dict(collection.doc)
    response = client.post("/markets/market-1/csv-proposal/confirm",
                           json={"csvContent": CSV, "year": 2026})
    assert response.status_code == 409
    assert collection.writes == [] and collection.doc == before


def test_confirm_that_loses_a_race_writes_nothing(client, markets, monkeypatch):
    """The market left draft between the read and the write: the conditioned update matches
    nothing, and the organizer is told."""
    collection = markets(_market())
    real_find = collection.find_one

    def find_then_publish(query):
        found = real_find(query)
        collection.doc["phase"] = "applications_open"
        return found

    monkeypatch.setattr(collection, "find_one", find_then_publish)
    response = client.post("/markets/market-1/csv-proposal/confirm",
                           json={"csvContent": CSV, "year": 2026})
    assert response.status_code == 409
    assert "importMapping" not in collection.doc
