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


class FakeMarketsCollection:
    def __init__(self, doc):
        self.doc = doc
        self.writes = []

    def find_one(self, query):
        return dict(self.doc) if all(self.doc.get(k) == v for k, v in query.items()) else None

    def update_one(self, *args, **kwargs):
        self.writes.append(args)

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
