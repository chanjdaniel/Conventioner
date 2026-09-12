"""Endpoint tests for POST /markets/<id>/transition (PR 2).

These exercise the route through the Flask test client so the wire contract
-- status codes and the camelCase blocker payload the frontend binds to --
is covered, not just guards.py in isolation.
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
import guards


OWNER_EMAIL = "owner@example.com"
OWNER_ID = "user-1"


def _market_doc(phase="draft", fields=None, is_draft=True):
    """A market document as it is stored in Mongo (camelCase keys).

    ``phase=None`` models a market created before the phase field existed and never
    touched by migrations/migrate_phase.py -- the document simply has no phase key.
    """
    doc = {
        "id": "market-1",
        "name": "Test Market",
        "creationDate": "2026-01-01",
        "roles": {OWNER_ID: "owner"},
        "modificationList": [],
        "assignmentObject": {},
        "isDraft": is_draft,
        "applicationForm": {"fields": fields if fields is not None else []},
    }
    if phase is not None:
        doc["phase"] = phase
    return doc


def _matches(doc, filter_query):
    """Mongo filter matching for the operators the transition endpoint uses."""
    for key, expected in filter_query.items():
        if isinstance(expected, dict) and "$exists" in expected:
            if (key in doc) != expected["$exists"]:
                return False
        elif doc.get(key) != expected:
            return False
    return True


class FakeMarketsCollection:
    """Honours the phase field in the filter so compare-and-set is testable."""

    def __init__(self, doc):
        self.doc = doc
        self.updates = []

    def find_one(self, query):
        return dict(self.doc) if _matches(self.doc, query) else None

    def update_one(self, filter_query, update):
        self.updates.append((filter_query, update))
        if not _matches(self.doc, filter_query):
            return SimpleNamespace(matched_count=0, modified_count=0)
        self.doc.update(update.get("$set", {}))
        return SimpleNamespace(matched_count=1, modified_count=1)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setitem(app_module.app.config, "LOGIN_DISABLED", True)
    monkeypatch.setattr(
        UsersApi, "get_user",
        lambda email: SimpleNamespace(id=OWNER_ID, email=email) if email == OWNER_EMAIL else None,
    )
    return app_module.app.test_client()


@pytest.fixture
def markets(monkeypatch):
    def _install(doc):
        collection = FakeMarketsCollection(doc)
        monkeypatch.setattr(MarketsApi, "markets_collection", collection)
        return collection
    return _install


def _post(client, body, email=OWNER_EMAIL):
    return client.post(
        "/markets/market-1/transition",
        json=body,
        headers={"X-Owner-Email": email},
    )


class TestTransitionSuccess:
    def test_draft_to_applications_open_when_form_has_fields(self, client, markets):
        collection = markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))

        response = _post(client, {"toPhase": "applications_open"})

        assert response.status_code == 200
        assert response.get_json() == {"phase": "applications_open"}
        assert collection.doc["phase"] == "applications_open"

    def test_accepts_snake_case_body(self, client, markets):
        markets(_market_doc(phase="applications_open"))

        response = _post(client, {"to_phase": "applications_closed"})

        assert response.status_code == 200

    def test_unguarded_transition_needs_no_preconditions(self, client, markets):
        markets(_market_doc(phase="applications_open"))

        response = _post(client, {"toPhase": "applications_closed"})

        assert response.status_code == 200
        assert response.get_json() == {"phase": "applications_closed"}

    def test_reopen_succeeds_when_form_has_fields(self, client, markets):
        collection = markets(_market_doc(
            phase="applications_closed",
            fields=[{"key": "name", "label": "Name", "type": "text"}],
        ))

        response = _post(client, {"toPhase": "applications_open"})

        assert response.status_code == 200
        assert response.get_json() == {"phase": "applications_open"}
        assert collection.doc["phase"] == "applications_open"

    def test_guards_receive_the_database_handle(self, client, markets, monkeypatch):
        markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))
        seen = []

        class RecordingGuard:
            id = "recording"
            description = "Records the db handle it was evaluated with"

            def evaluate(self, market, db):
                seen.append(db)
                return guards.PreconditionResult(id=self.id, passed=True, message="")

        monkeypatch.setitem(
            guards.TRANSITION_GUARDS, ("draft", "applications_open"), [RecordingGuard()]
        )

        response = _post(client, {"toPhase": "applications_open"})

        assert response.status_code == 200
        assert seen == [MarketsApi.db]

    def test_market_predating_the_phase_migration_can_still_publish(self, client, markets):
        collection = markets(_market_doc(
            phase=None,
            is_draft=True,
            fields=[{"key": "name", "label": "Name", "type": "text"}],
        ))

        response = _post(client, {"toPhase": "applications_open"})

        assert response.status_code == 200
        assert response.get_json() == {"phase": "applications_open"}
        assert collection.doc["phase"] == "applications_open"
        assert collection.updates[0][0] == {"id": "market-1", "phase": {"$exists": False}}

    def test_draft_to_archived_publishes_without_form(self, client, markets):
        """CSV publish path: no form guard needed for draft -> archived."""
        collection = markets(_market_doc(fields=[]))

        response = _post(client, {"toPhase": "archived"})

        assert response.status_code == 200
        assert response.get_json() == {"phase": "archived"}
        assert collection.doc["phase"] == "archived"
        assert collection.doc["isDraft"] is False

    def test_draft_to_archived_sets_is_draft_to_false(self, client, markets):
        """Publishing via transition must keep isDraft in sync with phase."""
        collection = markets(_market_doc())

        response = _post(client, {"toPhase": "archived"})

        assert response.status_code == 200
        assert collection.doc["isDraft"] is False


class TestTransitionBlocked:
    def test_empty_form_blocks_publish_with_camel_case_payload(self, client, markets):
        collection = markets(_market_doc(fields=[]))

        response = _post(client, {"toPhase": "applications_open"})

        assert response.status_code == 409
        body = response.get_json()
        assert body["error"] == "preconditions_not_met"
        assert body["currentPhase"] == "draft"
        assert body["targetPhase"] == "applications_open"

        blocker = body["blockers"][0]
        assert blocker["id"] == "form_has_fields"
        assert blocker["passed"] is False
        assert blocker["message"]
        assert blocker["resolutionLink"] == "/market-setup"

        assert collection.doc["phase"] == "draft"

    def test_empty_form_blocks_reopen(self, client, markets):
        collection = markets(_market_doc(phase="applications_closed", fields=[]))

        response = _post(client, {"toPhase": "applications_open"})

        assert response.status_code == 409
        body = response.get_json()
        assert body["error"] == "preconditions_not_met"
        assert body["currentPhase"] == "applications_closed"
        assert body["targetPhase"] == "applications_open"
        assert body["blockers"][0]["id"] == "form_has_fields"
        assert body["blockers"][0]["resolutionLink"] == "/market-setup"

        assert collection.doc["phase"] == "applications_closed"

    def test_phase_changed_underneath_returns_conflict(self, client, markets):
        collection = markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))

        original_update_one = collection.update_one

        def racing_update_one(filter_query, update):
            collection.doc["phase"] = "applications_open"
            return original_update_one(filter_query, update)

        collection.update_one = racing_update_one

        response = _post(client, {"toPhase": "applications_open"})

        assert response.status_code == 409
        body = response.get_json()
        assert body["error"] == "phase_changed"
        assert body["currentPhase"] == "applications_open"
        assert body["blockers"][0]["id"] == "phase_changed"
        assert body["blockers"][0]["passed"] is False

    def test_market_deleted_underneath_returns_not_found(self, client, markets):
        collection = markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))

        original_update_one = collection.update_one

        def deleting_update_one(filter_query, update):
            collection.doc = {}
            return original_update_one(filter_query, update)

        collection.update_one = deleting_update_one

        response = _post(client, {"toPhase": "applications_open"})

        assert response.status_code == 404
        assert response.get_json()["error"] == "Market not found"


class TestTransitionRejected:
    def test_body_that_is_not_json_is_400(self, client, markets):
        markets(_market_doc())

        response = client.post(
            "/markets/market-1/transition",
            data="toPhase=applications_open",
            content_type="text/plain",
            headers={"X-Owner-Email": OWNER_EMAIL},
        )

        assert response.status_code == 400
        assert response.get_json()["error"] == "No data provided"


    def test_transition_not_in_registry_is_400(self, client, markets):
        markets(_market_doc(phase="draft"))

        response = _post(client, {"toPhase": "applications_closed"})

        assert response.status_code == 400
        assert "not available" in response.get_json()["error"]

    def test_published_market_predating_the_migration_is_archived(self, client, markets):
        collection = markets(_market_doc(
            phase=None,
            is_draft=False,
            fields=[{"key": "name", "label": "Name", "type": "text"}],
        ))

        response = _post(client, {"toPhase": "applications_open"})

        assert response.status_code == 400
        assert "'archived'" in response.get_json()["error"]
        assert collection.updates == []

    def test_unknown_phase_is_400(self, client, markets):
        markets(_market_doc())

        response = _post(client, {"toPhase": "not_a_phase"})

        assert response.status_code == 400
        assert "Unknown phase" in response.get_json()["error"]

    def test_missing_to_phase_is_400(self, client, markets):
        markets(_market_doc())

        response = _post(client, {"foo": "bar"})

        assert response.status_code == 400

    def test_market_not_found_is_404(self, client, markets):
        collection = markets(_market_doc())
        collection.doc["id"] = "other-market"

        response = _post(client, {"toPhase": "applications_open"})

        assert response.status_code == 404

    def test_non_member_is_403(self, client, markets, monkeypatch):
        markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))
        monkeypatch.setattr(
            UsersApi, "get_user",
            lambda email: SimpleNamespace(id="stranger", email=email),
        )

        response = _post(client, {"toPhase": "applications_open"}, email="stranger@example.com")

        assert response.status_code == 403
