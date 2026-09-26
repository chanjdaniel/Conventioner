"""The plan saves only the plan (E21/F03/S02).

The plan's autosave used to send the whole market to ``PUT /markets/:id``, which stored the client's
entire copy and survived that only by re-applying every field the server owns. Under the back end
as the only source of truth, a write names what it changes: this one carries the plan and the
intake mode, and refuses anything else rather than re-applying over it.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
from datatypes import IntakeMode, MarketPhase, MarketRole

PLAN = {
    "priority": [],
    "marketDates": [{"date": "2026-08-01"}],
    "tiers": [{"id": 0, "name": "Gold"}],
    "locations": [{"name": "Main Hall"}],
    "sections": [],
    "assignmentOptions": {"maxAssignmentsPerVendor": 2, "maxHalfTableProportionPerSection": 50},
}


@pytest.fixture
def market(monkeypatch):
    """A market, and a record of the role the write was checked against."""
    checked = {}

    def permission(_user, _market, role, *_args, **_kwargs):
        checked["role"] = role
        return True

    def at(phase=MarketPhase.DRAFT, **stored):
        fake = FakeMarketsCollection(stored_market(phase=phase, **stored))
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        return fake

    monkeypatch.setattr(PermissionsApi, "user_has_permission", permission)
    at.checked = checked
    return at


def test_it_writes_the_plan_and_nothing_else(market):
    collection = market()

    MarketsApi.save_plan("market-123", {"setupObject": PLAN}, "user-1")

    written = collection.last_update["$set"]
    assert set(written) == {"setupObject"}
    assert written["setupObject"]["marketDates"] == [{"date": "2026-08-01"}]
    assert written["setupObject"]["assignmentOptions"]["maxAssignmentsPerVendor"] == 2


def test_it_writes_the_intake_mode_of_a_draft(market):
    collection = market()

    MarketsApi.save_plan(
        "market-123", {"setupObject": PLAN, "intakeMode": IntakeMode.FORM.value}, "user-1"
    )

    assert collection.last_update["$set"]["intakeMode"] == IntakeMode.FORM.value


def test_it_requires_the_same_role_every_market_write_does(market):
    market()

    MarketsApi.save_plan("market-123", {"setupObject": PLAN}, "user-1")

    assert market.checked["role"] == MarketRole.EDITOR


@pytest.mark.parametrize("field", ["name", "phase", "assignmentObject", "applicationForm", "slug"])
def test_a_body_naming_anything_else_is_refused(market, field):
    collection = market()

    with pytest.raises(ValueError, match=field):
        MarketsApi.save_plan("market-123", {"setupObject": PLAN, field: "anything"}, "user-1")

    assert collection.last_update is None


def test_a_body_without_the_plan_is_refused(market):
    market()

    with pytest.raises(ValueError, match="setupObject"):
        MarketsApi.save_plan("market-123", {"intakeMode": "csv"}, "user-1")


@pytest.mark.parametrize(
    "phase", [phase for phase in MarketPhase if phase != MarketPhase.DRAFT]
)
def test_the_intake_mode_cannot_change_after_draft(market, phase):
    collection = market(phase=phase)

    with pytest.raises(ValueError, match="draft"):
        MarketsApi.save_plan(
            "market-123", {"setupObject": PLAN, "intakeMode": IntakeMode.FORM.value}, "user-1"
        )

    assert collection.last_update is None


def test_restating_the_intake_mode_after_draft_is_not_a_change(market):
    """The plan saves as the organizer types in every phase, and says what intake mode it holds."""
    collection = market(phase=MarketPhase.REVIEW, intakeMode=IntakeMode.CSV.value)

    MarketsApi.save_plan(
        "market-123", {"setupObject": PLAN, "intakeMode": IntakeMode.CSV.value}, "user-1"
    )

    assert collection.last_update["$set"]["setupObject"]["tiers"] == [{"id": 0, "name": "Gold"}]


def test_a_malformed_plan_is_refused(market):
    collection = market()

    with pytest.raises(ValueError):
        MarketsApi.save_plan("market-123", {"setupObject": {"tiers": "not a list"}}, "user-1")

    assert collection.last_update is None


# The assignment rules close with the assignment (E22/F02/S01). A rule only takes effect when the
# assignment runs, and once a market has left `assignment` it can never run again - so a changed
# rule there would change nothing while reading as though it had. Listed here rather than derived,
# so the test is an independent statement of which phases those are.
SETTLED = [MarketPhase.OFFERS, MarketPhase.MARKET_DAYS, MarketPhase.ARCHIVED]
OPEN = [phase for phase in MarketPhase if phase not in SETTLED]

STORED_RULES = {
    **PLAN,
    "priority": [{"id": 0, "target": "application.submitted_at", "direction": "ascending"}],
    "assignmentOptions": {"maxAssignmentsPerVendor": 2, "maxHalfTableProportionPerSection": 50},
}


@pytest.mark.parametrize("phase", SETTLED)
@pytest.mark.parametrize(
    "change",
    [
        {"priority": []},
        {"priority": [{"id": 0, "target": "application.submitted_at", "direction": "descending"}]},
        {"assignmentOptions": {"maxAssignmentsPerVendor": 1, "maxHalfTableProportionPerSection": 50}},
        {"assignmentOptions": {"maxAssignmentsPerVendor": 2, "maxHalfTableProportionPerSection": 10}},
    ],
)
def test_after_the_assignment_a_rule_cannot_change(market, phase, change):
    collection = market(phase=phase, setupObject=STORED_RULES)

    with pytest.raises(ValueError, match="settled"):
        MarketsApi.save_plan("market-123", {"setupObject": {**STORED_RULES, **change}}, "user-1")

    assert collection.last_update is None


@pytest.mark.parametrize("phase", SETTLED)
def test_after_the_assignment_restating_the_rules_is_not_a_change(market, phase):
    """The plan saves as the organizer types, in every phase, and always carries the rules it holds."""
    collection = market(phase=phase, setupObject=STORED_RULES)

    edited = {**STORED_RULES, "locations": [{"name": "Main Hall"}, {"name": "Annex"}]}
    MarketsApi.save_plan("market-123", {"setupObject": edited}, "user-1")

    assert collection.last_update["$set"]["setupObject"]["locations"][1] == {"name": "Annex"}


@pytest.mark.parametrize("phase", OPEN)
def test_up_to_and_including_the_assignment_the_rules_save(market, phase):
    collection = market(phase=phase, setupObject=STORED_RULES)

    changed = {**STORED_RULES, "priority": []}
    MarketsApi.save_plan("market-123", {"setupObject": changed}, "user-1")

    assert collection.last_update["$set"]["setupObject"]["priority"] == []
