"""Back to review: from Assignment, until results are published, the review opens again (T207).

Driven through the market's own doors, as an organizer meets it: the transition endpoint moves the
market back, and the review's writes that Assignment refused - a verdict, an undo, a claim on a
card, a change of reviewers and of the automatic rejections - are taken once it is back. Once
results are published the move is refused, in the guard's words.
"""
import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from conftest import (  # noqa: E402
    COMPLETE_PLAN, mongo_matches, reject_malformed_update, sessions_load_through_get_user,
    skip_without_real_dependencies,
)

skip_without_real_dependencies()

import api.markets as MarketsApi  # noqa: E402
import api.users as UsersApi  # noqa: E402
import app as app_module  # noqa: E402
import db_config  # noqa: E402
from datatypes import ApplicationStatus, MarketPhase  # noqa: E402

OWNER_EMAIL = "owner@market.test"
OWNER_ID = "user-owner"
REVIEWER_EMAIL = "sam@market.test"
REVIEWER_ID = "user-sam"
MARKET = "market-1"
FIELDS = [{"key": "shop", "label": "Shop", "type": "text"}]


def _set_path(doc, key, value):
    head, _, tail = key.partition(".")
    if not tail:
        doc[key] = value
        return
    _set_path(doc.setdefault(head, {}), tail, value)


class Markets:
    """One market, written as Mongo writes it: a filter that misses writes nothing, and ``$set`` and
    ``$push`` land in the document, so a read after a move reads the move."""

    def __init__(self, doc):
        self.doc = doc
        # Another request's write, landing after this one has read the market and just before its
        # own write: the window two requests in flight together share.
        self.between = None

    def find_one(self, query, projection=None, **_kwargs):
        return dict(self.doc) if mongo_matches(self.doc, query or {}) else None

    def update_one(self, query, update, **_kwargs):
        reject_malformed_update(update)
        if self.between:
            between, self.between = self.between, None
            between(self.doc)
        if not mongo_matches(self.doc, query):
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        for key, value in update.get("$set", {}).items():
            _set_path(self.doc, key, value)
        for key, value in update.get("$push", {}).items():
            self.doc.setdefault(key, []).extend(value.get("$each", [value]))
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)

    def find_one_and_update(self, query, update, **kwargs):
        before = self.find_one(query)
        if before is None:
            return None
        self.update_one(query, update)
        return dict(self.doc)


def _market(phase=MarketPhase.ASSIGNMENT, intake="form", **overrides):
    return {
        "_id": "mongo-market-1",
        "id": MARKET,
        "name": "Riverside",
        "slug": "riverside",
        "creationDate": "2026-01-01T00:00:00Z",
        "roles": {OWNER_ID: "owner", REVIEWER_ID: "editor"},
        "modificationList": [],
        "assignmentObject": {"vendorAssignments": [], "assignmentStatistics": None},
        "isDraft": False,
        "phase": phase.value,
        "intakeMode": intake,
        "applicationForm": {"fields": FIELDS, "publishedAt": "2026-01-02T00:00:00Z"},
        "setupObject": COMPLETE_PLAN,
        "phaseHistory": [
            {"phase": "draft", "enteredAt": "2026-01-01T00:00:00Z", "by": OWNER_EMAIL},
            {"phase": "applications", "enteredAt": "2026-01-02T00:00:00Z", "by": OWNER_EMAIL},
            {"phase": "assignment", "enteredAt": "2026-01-03T00:00:00Z", "by": OWNER_EMAIL},
        ],
        **overrides,
    }


def _application(status=ApplicationStatus.REVIEWER_APPROVED):
    return {
        "id": "app-1", "market_id": MARKET, "applicant_email": "vendor@example.com",
        "form_data": {"shop": "Ember"}, "status": status.value, "application_type": "main",
        "submitted_at": "2026-01-02T00:00:00Z", "updated_at": "2026-01-02T00:00:00Z",
    }


@pytest.fixture
def world(monkeypatch, applications):
    people = {OWNER_EMAIL: OWNER_ID, REVIEWER_EMAIL: REVIEWER_ID}

    def _get_user(email):
        if email not in people:
            return None
        return SimpleNamespace(id=people[email], email=email, is_active=True, is_authenticated=True,
                               is_anonymous=False, get_id=lambda e=email: e)

    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(UsersApi, "get_user", _get_user)
    monkeypatch.setattr(UsersApi, "get_user_by_id", lambda user_id: next(
        (_get_user(email) for email, uid in people.items() if uid == user_id), None))
    applications.documents = [_application()]

    def install(doc):
        markets = Markets(doc)
        monkeypatch.setattr(MarketsApi, "markets_collection", markets)

        class _Db(dict):
            def __getitem__(self, name):
                assert name == "markets"
                return markets

        monkeypatch.setattr(db_config, "get_database", lambda *_a, **_kw: _Db())
        return markets

    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER_EMAIL
        session["_fresh"] = True
    return SimpleNamespace(client=client, install=install, applications=applications)


def _back(client):
    return client.post(f"/markets/{MARKET}/transition", json={"toPhase": "applications"})


def _review_writes(client):
    """The review's writes, each answered: a verdict changed, a follow-up decided and undone, a
    claim, reviewers and rules. An undo takes back a verdict given on an application awaiting one,
    so the approval is first sent to a follow-up."""
    verdict = client.put(f"/markets/{MARKET}/applications/app-1/review",
                         json={"status": "needs_follow_up"})
    decided = client.put(f"/markets/{MARKET}/applications/app-1/review",
                         json={"status": "reviewer_rejected"})
    # The undo is of the decision just given, as the card that gave it asks.
    given = (decided.get_json() or {}).get("application") or {}
    return {
        "verdict": verdict,
        "decided": decided,
        "undo": client.post(f"/markets/{MARKET}/applications/app-1/review/undo", json={
            "seen": {"status": "reviewer_rejected", "verdictAt": given.get("verdictAt")}}),
        "claim": client.put(f"/markets/{MARKET}/applications/app-1/claim"),
        "reviewers": client.put(f"/markets/{MARKET}/reviewers", json={"reviewers": []}),
        "rules": client.put(f"/markets/{MARKET}/rejection-rules", json={"rules": []}),
    }


class TestTheWayBack:
    def test_a_market_in_assignment_goes_back_to_the_review(self, world):
        markets = world.install(_market())

        response = _back(world.client)

        assert response.status_code == 200, response.get_json()
        assert markets.doc["phase"] == "applications"
        entered = markets.doc["phaseHistory"][-1]
        assert (entered["phase"], entered["by"]) == ("applications", OWNER_EMAIL)

    def test_the_move_is_in_the_markets_history(self, world, market_records):
        world.install(_market())

        assert _back(world.client).status_code == 200

        [entry] = [e for e in market_records.history.documents if e.get("market_id") == MARKET]
        assert entry["action"] == "move-phase"

    def test_the_review_refused_in_assignment_is_taken_after_it(self, world):
        world.install(_market())
        served = world.client.get(f"/markets/{MARKET}").get_json()["market"]
        refused = _review_writes(world.client)
        assert {name: r.status_code for name, r in refused.items()} == {
            "verdict": 403, "decided": 403, "undo": 403, "claim": 403, "reviewers": 400,
            "rules": 400,
        }
        # Each refusal is the review's close, as the market read serves it, not some other reason.
        closed = served["verdictsSettledReason"]
        assert closed
        assert {refused[name].get_json()["error"] for name in ("verdict", "decided", "undo", "claim")
                } == {closed}
        assert refused["rules"].get_json()["error"] == served["rejectionRulesLockReason"]
        assert refused["reviewers"].get_json()["error"].startswith("The review is closed")

        assert _back(world.client).status_code == 200
        reopened = world.client.get(f"/markets/{MARKET}").get_json()["market"]
        assert (reopened["verdictsSettledReason"], reopened["rejectionRulesLockReason"]) == (
            None, None)
        taken = _review_writes(world.client)

        assert {name: r.status_code for name, r in taken.items()} == {
            "verdict": 200, "decided": 200, "undo": 200, "claim": 200, "reviewers": 200,
            "rules": 200,
        }, {name: r.get_json() for name, r in taken.items()}

    def test_a_published_market_is_refused_in_the_guards_words(self, world):
        markets = world.install(_market(resultsPublished=True))

        response = _back(world.client)

        assert response.status_code == 409
        [blocker] = response.get_json()["blockers"]
        assert blocker["id"] == "results_not_published"
        assert blocker["message"] == (
            "Results are published: applicants have read whether they have a table, so the review "
            "cannot reopen. To change who has a table, place or free a seat on Assignments."
        )
        assert blocker["resolutionLink"] is None
        assert markets.doc["phase"] == "assignment"

    def test_a_google_form_market_goes_back_too(self, world):
        markets = world.install(_market(intake="csv"))

        assert _back(world.client).status_code == 200
        assert markets.doc["phase"] == "applications"


class TestTheWayBackAndPublishingNeverCross:
    """Back to review and Publish results each check the other's fact before they write, so each
    write is conditional on it too: two requests in flight together (two organizers, a stale tab)
    can never leave a market in the review with its results published (T207 review finding 1)."""

    def test_results_published_under_the_move_refuse_it(self, world):
        markets = world.install(_market())
        markets.between = lambda doc: doc.update(resultsPublished=True)

        response = _back(world.client)

        assert response.status_code == 409, response.get_json()
        assert [b["id"] for b in response.get_json()["blockers"]] == ["results_not_published"]
        assert markets.doc["phase"] == "assignment"
        assert [e["phase"] for e in markets.doc["phaseHistory"]][-1] == "assignment"

    def test_the_move_under_publishing_refuses_it(self, world, runs):
        markets = world.install(_market())
        runs()
        markets.between = lambda doc: doc.update(phase="applications")

        response = world.client.post(f"/markets/{MARKET}/publish-results")

        assert response.status_code == 409, response.get_json()
        assert response.get_json()["error"] == (
            "This market moved while the request was in flight. Reload it and try again.")
        assert markets.doc.get("resultsPublished") is not True

    def test_a_second_publish_in_flight_writes_nothing(self, world, runs, market_records):
        markets = world.install(_market())
        runs()
        markets.between = lambda doc: doc.update(resultsPublished=True)

        response = world.client.post(f"/markets/{MARKET}/publish-results")

        assert response.status_code == 409, response.get_json()
        assert [e for e in market_records.history.documents
                if e.get("action") == "publish-results"] == []


class TestApplyingStaysClosed:
    def test_a_form_markets_applications_stay_stopped(self, world):
        markets = world.install(_market(applicationsStopped=False))

        assert _back(world.client).status_code == 200

        assert markets.doc["applicationsStopped"] is True

    def test_a_google_form_markets_flag_is_left_alone(self, world):
        markets = world.install(_market(intake="csv"))

        assert _back(world.client).status_code == 200

        assert "applicationsStopped" not in markets.doc

    def test_take_applications_again_reopens_them_after_the_move(self, world):
        markets = world.install(_market())
        assert _back(world.client).status_code == 200

        response = world.client.post(
            f"/markets/{MARKET}/applications-stopped", json={"stopped": False})

        assert response.status_code == 200, response.get_json()
        assert markets.doc["applicationsStopped"] is False


# --- The stored run after the review reopens (ticket 02) ------------------------------------------

PINNED_EMAIL = "pinned@example.com"
DAY = "2099-08-01"


def _seat(email, table, hand_placed=False):
    return {"email": email, "date": DAY, "tableCode": f"Main Hall {table}",
            "tableChoice": "Full Table", "section": "Main Hall", "tier": "Gold",
            "location": "Main Hall", "handPlaced": hand_placed}


@pytest.fixture
def runs(world, monkeypatch):
    """The solver runs for real over the approved applications the review left, as a run reads
    them: each application named in ``approved`` stands for one vendor of the plan's one day."""
    import api.placements as PlacementsApi
    import assignment.made_from as MadeFrom
    from assignment.vendor_input import SolverVendor

    def approved():
        return [
            SolverVendor(
                application_id=doc["id"], email=doc["applicant_email"],
                available_dates=frozenset({DAY}), max_dates=1,
                accepted_tiers_by_date={DAY: frozenset({"Gold"})}, table_choice="Full Table",
                table_share_email=None, section_ranking=("Main Hall",), table_type_ranking=(),
                custom_answers={}, submitted_at=doc["submitted_at"],
            )
            for doc in world.applications.documents
            if doc["status"] == ApplicationStatus.REVIEWER_APPROVED.value
        ]

    monkeypatch.setattr(PlacementsApi, "solver_vendors_for", lambda _market: approved())
    monkeypatch.setattr(MadeFrom, "approved_solver_vendors", lambda *_a: (approved(), []))

    def run():
        response = world.client.post(f"/markets/{MARKET}/assignment")
        assert response.status_code == 200, response.get_json()

    return run


def _read(client):
    return client.get(f"/markets/{MARKET}").get_json()["market"]


def _begin(client):
    return client.post(f"/markets/{MARKET}/transition", json={"toPhase": "assignment"})


class TestTheRunAfterTheReviewReopens:
    def test_it_reads_out_of_date_by_the_review_until_it_runs_again(self, world, runs):
        world.install(_market())
        runs()
        assert _read(world.client)["assignmentOutOfDate"] == []

        assert _back(world.client).status_code == 200
        assert _begin(world.client).status_code == 200

        # No verdict changed, and the run is still out of date: it was made before this review.
        read = _read(world.client)
        assert read["assignmentOutOfDate"] == ["review"]
        assert read["publishWaitsReason"]
        refused = world.client.post(f"/markets/{MARKET}/publish-results")
        assert refused.status_code == 409
        assert refused.get_json()["error"] == read["publishWaitsReason"]

        runs()

        read = _read(world.client)
        assert read["assignmentOutOfDate"] == []
        assert read["publishWaitsReason"] is None
        assert world.client.post(f"/markets/{MARKET}/publish-results").status_code == 200

    def test_the_stored_assignment_is_kept_through_the_way_back_and_the_return(self, world, runs):
        markets = world.install(_market())
        runs()
        markets.doc["assignmentObject"]["vendorAssignments"].append(_seat(PINNED_EMAIL, 4, True))
        stored = [dict(seat) for seat in markets.doc["assignmentObject"]["vendorAssignments"]]
        made_from = dict(markets.doc["assignmentObject"]["madeFrom"])

        assert _back(world.client).status_code == 200
        assert _begin(world.client).status_code == 200

        assert markets.doc["assignmentObject"]["vendorAssignments"] == stored
        assert markets.doc["assignmentObject"]["madeFrom"] == made_from

    def test_a_pin_of_a_vendor_the_reopened_review_rejects_stays_marked_not_approved(
        self, world, runs,
    ):
        markets = world.install(_market())
        world.applications.documents.append({
            **_application(), "id": "app-2", "applicant_email": PINNED_EMAIL,
            "form_data": {"shop": "Kiln"},
        })
        runs()
        markets.doc["assignmentObject"]["vendorAssignments"].append(_seat(PINNED_EMAIL, 4, True))
        assert _back(world.client).status_code == 200

        rejected = world.client.put(f"/markets/{MARKET}/applications/app-2/review",
                                    json={"status": "reviewer_rejected"})
        assert rejected.status_code == 200, rejected.get_json()
        # Nothing blocks Begin assignment on the pin: it is ADR 0013's override.
        assert _begin(world.client).status_code == 200
        runs()

        pinned = [seat for seat in markets.doc["assignmentObject"]["vendorAssignments"]
                  if seat["email"] == PINNED_EMAIL]
        assert [(seat["tableCode"], seat["handPlaced"]) for seat in pinned] == [
            ("Main Hall 4", True)]
        statistics = world.client.get(f"/markets/{MARKET}/assignment-statistics").get_json()
        overridden = {entry["email"]: entry["overrides"]
                      for entry in statistics["overriddenPlacements"]}
        assert "not_approved" in overridden[PINNED_EMAIL]

    def test_a_hand_seat_the_plan_no_longer_has_is_named_on_begin_assignment(self, world, runs):
        markets = world.install(_market())
        runs()
        markets.doc["assignmentObject"]["vendorAssignments"].append(_seat(PINNED_EMAIL, 9, True))
        assert _back(world.client).status_code == 200

        response = _begin(world.client)

        assert response.status_code == 409
        assert "no_orphaned_pin" in {b["id"] for b in response.get_json()["blockers"]}


class TestGoingLiveAfterTheReviewReopens:
    def _live(self, client):
        return client.post(f"/markets/{MARKET}/transition", json={"toPhase": "market_days"})

    def test_a_google_form_market_waits_for_tables_allocated_again(self, world, runs):
        markets = world.install(_market(intake="csv"))
        runs()
        assert _back(world.client).status_code == 200
        assert _begin(world.client).status_code == 200

        refused = self._live(world.client)

        assert refused.status_code == 409
        blocker, results = refused.get_json()["blockers"]
        assert blocker["id"] == "assignment_after_review"
        assert blocker["message"] == (
            "The review was reopened after tables were allocated. Allocate tables again before "
            "the market goes live."
        )
        assert (blocker["resolutionLink"], blocker["resolutionLabel"],
                blocker["resolutionAction"]) == ("settings", "Allocate tables", "assign")
        # Its vendors read their results on its vendor page too, and that comes after the tables.
        assert results["id"] == "results_published"
        assert markets.doc["phase"] == "assignment"

        runs()
        refused = self._live(world.client)
        assert [b["id"] for b in refused.get_json()["blockers"]] == ["results_published"]
        published = world.client.post(f"/markets/{MARKET}/publish-results")
        assert published.status_code == 200, published.get_json()

        live = self._live(world.client)
        assert live.status_code == 200, live.get_json()
        assert markets.doc["phase"] == "market_days"
