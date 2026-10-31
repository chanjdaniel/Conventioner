"""Endpoint tests for POST /markets/<id>/transition (PR 2).

These exercise the route through the Flask test client so the wire contract
-- status codes and the camelCase blocker payload the frontend binds to --
is covered, not just guards.py in isolation.
"""
import os
import sys
from types import SimpleNamespace

import pytest
from conftest import COMPLETE_PLAN, sessions_load_through_get_user

from conftest import skip_without_real_dependencies

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.markets as MarketsApi
import api.users as UsersApi
import guards


OWNER_EMAIL = "owner@example.com"
OWNER_ID = "user-1"


def response_ok(response):
    assert response.status_code == 200, response.get_json()
    return True


def _market_doc(phase="draft", fields=None, is_draft=True, plan=COMPLETE_PLAN, intake="form"):
    """A market document as it is stored in Mongo (camelCase keys), whose vendors apply on its page
    unless ``intake`` says otherwise: a Google Form market's way into the stage is its import.

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
        # Complete, so leaving draft is judged on the form alone here (E31/F01/S01).
        "setupObject": plan,
        "intakeMode": intake,
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


def _set_path(doc, key, value):
    """A dotted `$set` writes into the nested document, as Mongo does.

    A flat `dict.update` would store the literal key "applicationForm.publishedAt" beside the form
    rather than inside it, so a test asserting the stamp would pass against a document shape the
    database never produces.
    """
    head, _, tail = key.partition(".")
    if not tail:
        doc[key] = value
        return
    target = doc.setdefault(head, {})
    _set_path(target, tail, value)


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
        for key, value in update.get("$set", {}).items():
            _set_path(self.doc, key, value)
        return SimpleNamespace(matched_count=1, modified_count=1)


@pytest.fixture
def client(monkeypatch):
    """Signed in as the owner, for real.

    This used to set ``LOGIN_DISABLED`` and pass the caller's identity in an ``X-Owner-Email``
    header, which is exactly the hole E07/F01/S02 closed: the header is not an authorization input
    any more, so a test that supplies identity that way is testing nothing. The session is the
    identity here as it is in production.
    """
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(
        UsersApi, "get_user",
        lambda email: SimpleNamespace(
            id=OWNER_ID, email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        ) if email == OWNER_EMAIL else None,
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


def _post(client, body, email=OWNER_EMAIL):
    """Post as whoever the session says; ``email`` re-signs the client when it is someone else."""
    if email != OWNER_EMAIL:
        with client.session_transaction() as session:
            session["_user_id"] = email
            session["_fresh"] = True
    return client.post("/markets/market-1/transition", json=body)


def _spy_on_the_conflict(monkeypatch):
    """Every ``PhaseChangedUnderRequest`` the move raises, kept as it passes to the route."""
    raised = []
    take_move = MarketsApi.take_move

    def spying(*args, **kwargs):
        try:
            return take_move(*args, **kwargs)
        except MarketsApi.PhaseChangedUnderRequest as changed:
            raised.append(changed)
            raise
    monkeypatch.setattr(MarketsApi, "take_move", spying)
    return raised


class TestTransitionSuccess:
    def test_draft_to_applications_when_form_has_fields(self, client, markets):
        collection = markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))

        response = _post(client, {"toPhase": "applications"})

        assert response.status_code == 200
        assert response.get_json() == {"phase": "applications"}
        assert collection.doc["phase"] == "applications"

    def test_the_move_is_recorded_with_who_made_it_in_the_same_update(self, client, markets):
        """The market's phase history (E26/F06/S03) is written by the phase writer, atomically."""
        collection = markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))

        assert response_ok(_post(client, {"toPhase": "applications"}))

        [(_, update)] = collection.updates
        entered = update["$push"]["phaseHistory"]["$each"][-1]
        assert entered["phase"] == "applications"
        assert entered["by"] == OWNER_EMAIL
        assert update["$set"]["phase"] == "applications"

    def test_opening_applications_stamps_the_form_in_the_same_update(self, client, markets):
        """Leaving draft IS finalizing (E18/F03/S01), and the stamp lands atomically with the phase.

        The field was designed for this, threaded through the market API and read by two front-end
        components - and nothing ever assigned it.
        """
        collection = markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))

        assert response_ok(_post(client, {"toPhase": "applications"}))
        assert collection.doc["phase"] == "applications"
        assert collection.doc["applicationForm"]["publishedAt"]
        assert collection.doc["applicationForm"]["fields"][0]["key"] == "name"

    def test_returning_to_draft_clears_the_stamp(self, client, markets):
        collection = markets(
            _market_doc(phase="applications", is_draft=False, fields=[])
        )
        collection.doc["applicationForm"]["publishedAt"] = "2026-09-01T00:00:00+00:00"

        assert response_ok(_post(client, {"toPhase": "draft"}))
        assert collection.doc["applicationForm"]["publishedAt"] is None

    def test_publishing_straight_from_draft_does_not_stamp(self, client, markets):
        """What keeps the field from being a restatement of `phase != draft`: a market published by
        this route never opened its form to anybody."""
        collection = markets(_market_doc())

        assert response_ok(_post(client, {"toPhase": "archived"}))
        assert collection.doc["phase"] == "archived"
        assert collection.doc["applicationForm"].get("publishedAt") is None

    def test_accepts_snake_case_body(self, client, markets):
        markets(_market_doc(phase="applications"))

        response = _post(client, {"to_phase": "archived"})

        assert response.status_code == 200

    def test_unguarded_transition_needs_no_preconditions(self, client, markets):
        markets(_market_doc(phase="applications"))

        response = _post(client, {"toPhase": "archived"})

        assert response.status_code == 200
        assert response.get_json() == {"phase": "archived"}

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
            guards.TRANSITION_GUARDS, ("draft", "applications"), [RecordingGuard()]
        )

        response = _post(client, {"toPhase": "applications"})

        assert response.status_code == 200
        assert seen == [MarketsApi.db]

    def test_market_predating_the_phase_migration_can_still_publish(self, client, markets):
        collection = markets(_market_doc(
            phase=None,
            is_draft=True,
            fields=[{"key": "name", "label": "Name", "type": "text"}],
        ))

        response = _post(client, {"toPhase": "applications"})

        assert response.status_code == 200
        assert response.get_json() == {"phase": "applications"}
        assert collection.doc["phase"] == "applications"
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
        # No plan either: a complete setup always gives the form something to ask (E31/F01/S01).
        collection = markets(_market_doc(fields=[], plan=None))

        response = _post(client, {"toPhase": "applications"})

        assert response.status_code == 409
        body = response.get_json()
        assert body["error"] == "preconditions_not_met"
        assert body["currentPhase"] == "draft"
        assert body["targetPhase"] == "applications"

        blocker = next(b for b in body["blockers"] if b["id"] == "form_has_fields")
        assert blocker["passed"] is False
        assert blocker["message"]
        # The key is on the wire and camelCased, which is what this test is named for. Its value is
        # null because this guard's two remedies sit in two different tabs, so there is no one
        # place to send the organizer (E14/F01/S03).
        assert "resolutionLink" in blocker
        assert "resolution_link" not in blocker
        assert blocker["resolutionLink"] is None
        assert blocker["resolutionLabel"] is None
        assert blocker["resolutionAction"] is None

        # No plan, so the setup's guard refuses too, and its remedy names the row of the table it
        # takes (T142): the rail's panel offers the link only to someone that row lets take it.
        dates = next(b for b in body["blockers"] if b["id"] == "setup_has_dates")
        assert dates["resolutionLink"] == "setup"
        assert dates["resolutionAction"] == "change-setup"

        assert collection.doc["phase"] == "draft"

    def test_phase_changed_underneath_returns_conflict(self, client, markets):
        collection = markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))

        original_update_one = collection.update_one

        def racing_update_one(filter_query, update):
            collection.doc["phase"] = "archived"
            return original_update_one(filter_query, update)

        collection.update_one = racing_update_one

        response = _post(client, {"toPhase": "applications"})

        assert response.status_code == 409
        body = response.get_json()
        assert body["error"] == "phase_changed"
        assert body["currentPhase"] == "archived"
        assert body["blockers"][0]["id"] == "phase_changed"
        assert body["blockers"][0]["passed"] is False

    def test_the_conflict_raised_carries_the_answer_the_route_gives(
        self, client, markets, monkeypatch,
    ):
        """The conflict can answer for itself once a route stops building its payload."""
        raised = _spy_on_the_conflict(monkeypatch)
        collection = markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))
        original_update_one = collection.update_one

        def racing_update_one(filter_query, update):
            collection.doc["phase"] = "archived"
            return original_update_one(filter_query, update)
        collection.update_one = racing_update_one

        response = _post(client, {"toPhase": "applications"})

        assert response.status_code == raised[0].status == 409
        assert response.get_json() == raised[0].body()

    def test_market_deleted_underneath_returns_not_found(self, client, markets):
        collection = markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))

        original_update_one = collection.update_one

        def deleting_update_one(filter_query, update):
            collection.doc = {}
            return original_update_one(filter_query, update)

        collection.update_one = deleting_update_one

        response = _post(client, {"toPhase": "applications"})

        assert response.status_code == 404
        assert response.get_json()["error"] == "Market not found"


class TestTransitionRejected:
    def test_body_that_is_not_json_is_400(self, client, markets):
        markets(_market_doc())

        response = client.post(
            "/markets/market-1/transition",
            data="toPhase=applications",
            content_type="text/plain",
            headers={"X-Owner-Email": OWNER_EMAIL},
        )

        assert response.status_code == 400
        assert response.get_json()["error"] == "No data provided"


    def test_transition_not_in_registry_is_400(self, client, markets):
        markets(_market_doc(phase="draft"))

        response = _post(client, {"toPhase": "assignment"})

        assert response.status_code == 400
        assert "not available" in response.get_json()["error"]

    def test_published_market_predating_the_migration_is_archived(self, client, markets):
        collection = markets(_market_doc(
            phase=None,
            is_draft=False,
            fields=[{"key": "name", "label": "Name", "type": "text"}],
        ))

        response = _post(client, {"toPhase": "applications"})

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

        response = _post(client, {"toPhase": "applications"})

        assert response.status_code == 404

    def test_non_member_is_403(self, client, markets, monkeypatch):
        markets(_market_doc(fields=[{"key": "name", "label": "Name", "type": "text"}]))
        monkeypatch.setattr(
            UsersApi, "get_user",
            lambda email: SimpleNamespace(
                id="stranger", email=email, is_active=True, is_authenticated=True,
                is_anonymous=False, get_id=lambda e=email: e,
            ),
        )

        response = _post(client, {"toPhase": "applications"}, email="stranger@example.com")

        assert response.status_code == 403


class TestTheGoogleFormPath:
    """A Google Form market enters Review by its first import, never by a bare move (E38/F04/S01)."""

    @pytest.fixture
    def imported(self, monkeypatch):
        import api.applications as ApplicationsApi

        def _set(n):
            monkeypatch.setattr(ApplicationsApi, "count_applications_for_market", lambda _id: n)
        return _set

    def test_nothing_moves_while_nothing_has_been_imported(self, client, markets, imported):
        imported(0)
        collection = markets(_market_doc(
            fields=[{"key": "name", "label": "Name", "type": "text"}], intake="csv",
        ))

        response = _post(client, {"toPhase": "applications"})

        assert response.status_code == 409
        [blocker] = response.get_json()["blockers"]
        assert blocker["id"] == "responses_imported"
        assert blocker["resolutionLink"] == "import"
        assert collection.doc["phase"] == "draft"
        assert collection.updates == []

    def test_a_draft_holding_imported_responses_may_enter_review(self, client, markets, imported):
        """What the import's own move meets once its rows are written."""
        imported(2)
        collection = markets(_market_doc(
            fields=[{"key": "name", "label": "Name", "type": "text"}], intake="csv",
        ))

        assert response_ok(_post(client, {"toPhase": "applications"}))
        assert collection.doc["phase"] == "applications"
