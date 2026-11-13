"""Every write of the assignment lands only on the market it read: a run never lands after Publish
results, and no placement, free or swap lands on a market archived a moment before.

Each test lands a second change between the request's read and its write (``interleave``), made
through its own module function, and asserts what a person and a later reader see: the 409 and its
one sentence, the stored assignment as the other change left it, and only the other change's
history.
"""
import api.applicants as ApplicantsApi
import api.market_actions as Actions
from conftest import a_solver_vendor
from datatypes import Application, ApplicationStatus, MarketPhase
from market_write import MARKET_CHANGED
from real_mongo.test_a_judged_write_lands_only_on_the_market_it_judged import (
    _history, _move, _stored,
)

ORGANIZER = "fixture-organizer@example.com"
CHANGED = {"error": MARKET_CHANGED, "code": "market_changed"}
#: ``COMPLETE_PLAN``'s one date, and two of its tables.
DATE = "2099-08-01"
FIRST, SECOND = "Main Hall 1", "Main Hall 2"
SEATED = "vendor-1@example.com"
OTHER = "vendor-2@example.com"


def _seat(email, table_code):
    return {"email": email, "date": DATE, "tableCode": table_code, "tableChoice": "Full Table",
            "section": "Main Hall", "tier": "Gold", "location": "Main Hall", "handPlaced": False}


def _applied(applications, market, *emails):
    for email in emails:
        applications.insert_one(Application(
            market_id=market["id"], applicant_email=email, form_data={"business": "Fixture Stall"},
            status=ApplicationStatus.ASSIGNED).model_dump())


def _actions(market_records, market):
    return [entry["action"] for entry in _history(market_records, market)]


def _assignment_left_as(real_db, market, assignment):
    stored = _stored(real_db, market)["assignmentObject"]
    assert stored["revision"] == assignment["revision"]
    assert stored["vendorAssignments"] == assignment["vendorAssignments"]


class TestAllocateTables:
    def test_is_refused_when_results_were_published_before_its_allocation_landed(
            self, signed_in, market_in, allocated, interleave, monkeypatch, real_db,
            market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.ASSIGNMENT, intakeMode="form")
        assignment = allocated(market, [_seat(SEATED, FIRST)])
        monkeypatch.setattr("api.placements.solver_vendors_for", lambda _market: [a_solver_vendor(
            "app-2", email=OTHER, available_dates=frozenset({DATE}),
            accepted_tiers_by_date={DATE: frozenset({"Gold"})})])
        published = []
        interleave("api.placements.assign_market", lambda: published.append(
            ApplicantsApi.publish_results(market["id"], ORGANIZER)))

        response = client.post(f"/markets/{market['id']}/assignment")

        assert published == [({"results_published": True}, 200)]
        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _stored(real_db, market)["resultsPublished"] is True
        # The allocation the applicants were told is the one still stored.
        _assignment_left_as(real_db, market, assignment)
        assert _actions(market_records, market) == [Actions.PUBLISH_RESULTS.id]


class TestAHandPlacement:
    def test_is_refused_when_the_market_was_archived_before_it_landed(
            self, signed_in, market_in, allocated, interleave, applications, real_db,
            market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.MARKET_DAYS)
        assignment = allocated(market, [_seat(SEATED, FIRST)])
        _applied(applications, market, SEATED, OTHER)
        interleave("api.placements._applicant_address", _move(market, MarketPhase.ARCHIVED))

        response = client.put(f"/markets/{market['id']}/placements", json={
            "email": OTHER, "date": DATE, "tableCode": SECOND, "tableChoice": "Full Table"})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _stored(real_db, market)["phase"] == MarketPhase.ARCHIVED.value
        _assignment_left_as(real_db, market, assignment)
        assert _history(market_records, market) == []


class TestAFree:
    def test_is_refused_when_the_market_was_archived_before_it_landed(
            self, signed_in, market_in, allocated, interleave, applications, real_db,
            market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.MARKET_DAYS)
        assignment = allocated(market, [_seat(SEATED, FIRST)])
        _applied(applications, market, SEATED)
        interleave("api.payments.keep_freed_line", _move(market, MarketPhase.ARCHIVED))

        response = client.delete(f"/markets/{market['id']}/placements",
                                 json={"email": SEATED, "date": DATE})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _stored(real_db, market)["phase"] == MarketPhase.ARCHIVED.value
        _assignment_left_as(real_db, market, assignment)
        assert _history(market_records, market) == []


class TestASwap:
    def test_is_refused_when_the_market_was_archived_before_it_landed(
            self, signed_in, market_in, allocated, interleave, applications, real_db,
            market_records):
        client = signed_in(ORGANIZER)
        market = market_in(MarketPhase.MARKET_DAYS)
        assignment = allocated(market, [_seat(SEATED, FIRST), _seat(OTHER, SECOND)])
        _applied(applications, market, SEATED, OTHER)
        interleave("api.placements._applicant_address", _move(market, MarketPhase.ARCHIVED))

        response = client.post(f"/markets/{market['id']}/placements/swap",
                               json={"date": DATE, "emails": [SEATED, OTHER]})

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == CHANGED
        assert _stored(real_db, market)["phase"] == MarketPhase.ARCHIVED.value
        _assignment_left_as(real_db, market, assignment)
        assert _history(market_records, market) == []
