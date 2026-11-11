"""``POST /markets/<id>/csv-proposal`` through the Flask test client (E24/F02/S01).

The proposal is read-only by contract: the file is read and let go, and nothing about the market
changes. The route is where that promise is kept or broken, so it is asserted here.
"""
import os
import sys
from types import SimpleNamespace

import pytest

from conftest import mongo_matches, sessions_load_through_get_user, skip_without_real_dependencies

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.markets as MarketsApi
import api.users as UsersApi
import market_write as MarketWrite
from datatypes import MarketRole

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
        return dict(self.doc) if mongo_matches(self.doc, query) else None

    def update_one(self, query, update, **kwargs):
        self.writes.append((query, update))
        if not mongo_matches(self.doc, query):
            return SimpleNamespace(matched_count=0, modified_count=0)
        self.doc.update(update.get("$set", {}))
        return SimpleNamespace(matched_count=1, modified_count=1)

    def find_one_and_update(self, query, update, projection=None, return_document=False):
        """``update_one``, answering the market after it as ``market_write`` asks."""
        if not self.update_one(query, update).matched_count:
            return None
        return dict(self.doc)

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
    sessions_load_through_get_user(monkeypatch)
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
        monkeypatch.setattr(MarketWrite, "markets_collection", collection)
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
    markets(_market(phase="applications"))
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
    reads = []

    def find_then_publish(query):
        found = real_find(query)
        reads.append(query)
        # The route reads the market twice, to ask the row and then for the document it judges:
        # the move lands after the second.
        if len(reads) == 2:
            collection.doc["phase"] = "applications"
        return found

    monkeypatch.setattr(collection, "find_one", find_then_publish)
    response = client.post("/markets/market-1/csv-proposal/confirm",
                           json={"csvContent": CSV, "year": 2026})
    assert response.status_code == 409
    assert response.get_json() == {"error": MarketWrite.MARKET_CHANGED, "code": "market_changed"}
    assert "importMapping" not in collection.doc


class TestTheStartAsksAssignWhenItsRulesDiffer:
    """The start writes the plan, and the assignment rules ride in it: a start whose rules differ
    from the market's asks the Assign row as the plan write does (E39/F01/S01), so the import row
    alone does not change a rule the Assign row keeps from this person."""

    ADMIN_EMAIL = "admin@example.com"

    @pytest.fixture
    def an_admin_the_assignment_row_refuses(self, client, markets, monkeypatch):
        """A draft whose Assign row asks its owner, confirmed by an Admin, whom the import row
        lets in. Returns the markets collection."""
        monkeypatch.setattr(
            MarketsApi.PermissionsApi, "get_user_market_role",
            lambda email, *_a, **_k: MarketRole.ADMIN if email == self.ADMIN_EMAIL else None)
        monkeypatch.setattr(
            UsersApi, "get_user",
            lambda email: SimpleNamespace(
                id="user-3", email=email, is_active=True, is_authenticated=True,
                is_anonymous=False, get_id=lambda e=email: e,
            ) if email == self.ADMIN_EMAIL else None,
        )
        with client.session_transaction() as session:
            session["_user_id"] = self.ADMIN_EMAIL
        return markets({**_market(), "permissions": {"assign": {"role": "owner", "source": "market"}}})

    def test_a_start_setting_a_vendors_most_tables_is_refused_and_writes_nothing(
            self, client, an_admin_the_assignment_row_refuses):
        collection = an_admin_the_assignment_row_refuses
        before = dict(collection.doc)

        response = client.post("/markets/market-1/csv-proposal/confirm",
                               json={"csvContent": CSV, "year": 2026, "ceiling": 3})

        assert response.status_code == 403, response.get_json()
        assert "change its assignment rules" in response.get_json()["error"]
        assert collection.writes == [] and collection.doc == before

    def test_a_start_keeping_the_markets_own_rules_is_written(
            self, client, an_admin_the_assignment_row_refuses):
        collection = an_admin_the_assignment_row_refuses

        response = client.post("/markets/market-1/csv-proposal/confirm",
                               json={"csvContent": CSV, "year": 2026})

        assert response.status_code == 200, response.get_json()
        assert len(collection.writes) == 1
        assert "importMapping" in collection.doc
