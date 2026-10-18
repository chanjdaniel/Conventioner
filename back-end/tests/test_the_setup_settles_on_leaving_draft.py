"""The setup refuses changes once the market has left draft (E31/F01/S02).

Everything on Market Setup saved in every phase but archived, so a date could be removed after
vendors chose it and a section emptied after they were placed in it. The setup now settles when the
market leaves draft: the plan write and the floorplan save refuse a change to it from then on, while
the assignment rules - which ride in the same object and are not setup - keep their own lock.
"""
import copy

import pytest

from conftest import COMPLETE_PLAN, FakeMarketsCollection, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import MarketPhase

AFTER_DRAFT = [p for p in MarketPhase if p not in (MarketPhase.DRAFT, MarketPhase.ARCHIVED)]


@pytest.fixture
def market(monkeypatch, applications):
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_kw: True)

    def at(phase):
        fake = FakeMarketsCollection(stored_market(phase=phase, setupObject=COMPLETE_PLAN))
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        return fake

    return at


def _changed(**change):
    plan = copy.deepcopy(COMPLETE_PLAN)
    plan.update(change)
    return plan


CHANGES = {
    "a date": {"marketDates": [{"date": "2099-08-02"}]},
    "a location": {"locations": [{"name": "Annex"}]},
    "a section's tables": {"sections": [{**COMPLETE_PLAN["sections"][0], "count": 9}]},
    "a tier": {"tiers": [{"id": 0, "name": "Platinum"}]},
}


@pytest.mark.parametrize("phase", AFTER_DRAFT)
@pytest.mark.parametrize("what", CHANGES)
def test_after_draft_a_change_to_the_setup_is_refused(market, phase, what):
    collection = market(phase)

    with pytest.raises(ValueError, match="settled"):
        MarketsApi.save_plan("market-123", {"setupObject": _changed(**CHANGES[what])}, "user-1")
    assert collection.last_update is None


@pytest.mark.parametrize("what", CHANGES)
def test_in_draft_each_change_saves(market, what):
    collection = market(MarketPhase.DRAFT)

    MarketsApi.save_plan("market-123", {"setupObject": _changed(**CHANGES[what])}, "user-1")

    assert collection.last_update is not None


@pytest.mark.parametrize("phase", AFTER_DRAFT)
def test_restating_the_stored_setup_is_not_a_change(market, phase):
    """The plan saves as the organizer types, in every phase, and always carries the whole setup."""
    collection = market(phase)

    MarketsApi.save_plan("market-123", {"setupObject": COMPLETE_PLAN}, "user-1")

    assert collection.last_update is not None


@pytest.mark.parametrize("phase", [MarketPhase.REVIEW, MarketPhase.ASSIGNMENT])
def test_the_rules_are_not_setup_and_still_save(market, phase):
    collection = market(phase)
    rules = _changed(assignmentOptions={"maxAssignmentsPerVendor": 2})

    MarketsApi.save_plan("market-123", {"setupObject": rules}, "user-1")

    assert collection.last_update["$set"]["setupObject"]["assignmentOptions"][
        "maxAssignmentsPerVendor"] == 2


def test_the_reason_rides_on_the_market_and_names_the_way_back(applications):
    def reason(phase, applied=0):
        applications.count = applied
        market = MarketsApi.market_from_document(
            stored_market(phase=phase, setupObject=COMPLETE_PLAN))
        return MarketsApi.setup_lock_reason(market)

    assert reason(MarketPhase.DRAFT) is None
    assert "settled" in reason(MarketPhase.APPLICATIONS_OPEN)
    assert "back to draft" in reason(MarketPhase.APPLICATIONS_OPEN)
    assert "back to draft" not in reason(MarketPhase.APPLICATIONS_OPEN, applied=1)
    assert "back to draft" not in reason(MarketPhase.REVIEW)


@pytest.mark.parametrize("phase", AFTER_DRAFT)
def test_a_floorplan_cannot_rewrite_the_sections_after_draft(market, monkeypatch, phase):
    """The floorplan save writes the sections and locations, which are setup."""
    from types import SimpleNamespace

    import app as app_module
    import api.users as UsersApi

    collection = market(phase)
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    monkeypatch.setattr(UsersApi, "get_user", lambda email: SimpleNamespace(
        id="user-1", email=email, is_active=True, is_authenticated=True, is_anonymous=False,
        get_id=lambda e=email: e))
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = "owner@example.com"
        session["_fresh"] = True

    response = client.post("/floorplans/save-to-market",
                           json={"market_id": "market-123", "floorplan": {"sections": []}})

    assert response.status_code == 409
    assert "settled" in response.get_json()["error"]
    assert collection.last_update is None
