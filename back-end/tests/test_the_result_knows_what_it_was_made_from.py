"""The result knows what it was made from (E22/F03/S01).

Editing the rules, the plan or the approved applications never changes a stored assignment - only
running it again does. So each run records a fingerprint of each of the three things the solver
read, and the market says which of them has changed since. Hand placements are not an input: they
are edits to the result, so they never make it out of date.

A fourth group, ``review`` (T207, ADR 0021), is how many times the market has entered the review
stage: Back to review makes the stored run out of date until the next one, whether or not a verdict
changed.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import assignment.made_from as MadeFrom
from assignment.utils import convert_keys_to_snake_case
from assignment.vendor_input import SolverVendor
from datatypes import (
    AssignmentObject, MarketPhase, PhaseEntry, SetupObject, VendorAssignmentResult,
)


PLAN = {
    "priority": [{"id": 0, "target": "application.submitted_at", "direction": "ascending"}],
    "marketDates": [{"date": "2026-08-01"}, {"date": "2026-08-02"}],
    "tiers": [{"id": 1, "name": "Gold"}],
    "locations": [{"name": "Main Hall"}],
    "sections": [
        {"name": "Hall A", "location": {"name": "Main Hall"}, "tier": {"id": 1, "name": "Gold"}, "count": 2}
    ],
    "assignmentOptions": {"maxAssignmentsPerVendor": 2, "maxHalfTableProportionPerSection": 50},
}


def vendor(application_id="app-1", **overrides) -> SolverVendor:
    fields = dict(
        application_id=application_id,
        email=f"{application_id}@example.com",
        available_dates=frozenset({"2026-08-01", "2026-08-02"}),
        max_dates=2,
        accepted_tiers_by_date={"2026-08-01": frozenset({"Gold"})},
        table_choice="Full Table",
        table_share_email=None,
        section_ranking=("Hall A",),
        table_type_ranking=(),
        custom_answers={"category": "Ceramics"},
        submitted_at="2026-06-01T10:00:00Z",
    )
    fields.update(overrides)
    return SolverVendor(**fields)


def plan(**changes) -> SetupObject:
    return SetupObject(**convert_keys_to_snake_case({**PLAN, **changes}))


def entries(*phases):
    return [PhaseEntry(phase=phase, entered_at="2026-01-01T00:00:00Z") for phase in phases]


#: A market that entered the review stage once and then Assignment, as a run in Assignment reads it.
ONCE = ("draft", "applications", "assignment")


def prints(setup=None, vendors=None, history=ONCE):
    return MadeFrom.fingerprint(
        setup or plan(), vendors if vendors is not None else [vendor()], entries(*history)
    )


# --- The fingerprint: one per group, and only its own group moves ---------------------------


def test_the_same_inputs_are_the_same_fingerprint():
    assert prints() == prints()
    assert set(prints()) == {"rules", "plan", "applications", "review"}


@pytest.mark.parametrize(
    "changes, moved",
    [
        ({"priority": []}, "rules"),
        ({"assignmentOptions": {"maxAssignmentsPerVendor": 1, "maxHalfTableProportionPerSection": 50}}, "rules"),
        ({"assignmentOptions": {"maxAssignmentsPerVendor": 2, "maxHalfTableProportionPerSection": 10}}, "rules"),
        ({"marketDates": [{"date": "2026-08-01"}]}, "plan"),
        ({"tiers": [{"id": 1, "name": "Gold"}, {"id": 2, "name": "Silver"}]}, "plan"),
        ({"locations": [{"name": "Main Hall"}, {"name": "Annex"}]}, "plan"),
        (
            {"sections": [{"name": "Hall A", "location": {"name": "Main Hall"}, "tier": {"id": 1, "name": "Gold"}, "count": 3}]},
            "plan",
        ),
    ],
)
def test_a_change_to_the_plan_moves_only_its_own_group(changes, moved):
    before, after = prints(), prints(setup=plan(**changes))
    assert [group for group in before if before[group] != after[group]] == [moved]


@pytest.mark.parametrize(
    "vendors",
    [
        [],
        [vendor(), vendor("app-2")],
        [vendor(custom_answers={"category": "Food"})],
        [vendor(available_dates=frozenset({"2026-08-01"}))],
        [vendor(submitted_at="2026-06-02T10:00:00Z")],
    ],
)
def test_a_change_to_the_approved_applications_moves_only_that_group(vendors):
    before, after = prints(), prints(vendors=vendors)
    assert [group for group in before if before[group] != after[group]] == ["applications"]


@pytest.mark.parametrize(
    "history",
    [
        # Back to review, then Begin assignment again.
        ("draft", "applications", "assignment", "applications", "assignment"),
        # Back to review, still in the stage.
        ("draft", "applications", "assignment", "applications"),
        # Reopened for editing before assignment, then into the stage again.
        ("draft", "applications", "draft", "applications", "assignment"),
    ],
)
def test_entering_the_review_again_moves_only_the_review_group(history):
    before, after = prints(), prints(history=history)
    assert [group for group in before if before[group] != after[group]] == ["review"]


@pytest.mark.parametrize(
    "history",
    [
        # Moves that never enter the stage again.
        ("draft", "applications", "assignment", "market_days"),
        ("draft", "applications", "assignment", "offers", "market_days", "archived"),
        # An old stage name is the stage, and walking through the old stage's phases is one entry.
        ("draft", "applications_open", "applications_closed", "review", "assignment"),
        ("draft", "review", "assignment"),
        # A record begun partway through: its first entry is the phase the market was already in.
        ("applications", "assignment"),
    ],
)
def test_the_review_group_counts_entries_into_the_stage(history):
    assert prints(history=history)["review"] == prints()["review"]


def test_a_record_begun_in_assignment_has_not_entered_the_review():
    assert prints(history=("assignment", "market_days"))["review"] == prints(history=())["review"]
    assert prints(history=("assignment", "applications"))["review"] == prints()["review"]


def test_the_order_things_arrive_in_is_not_a_change():
    """Dates are a set of days and vendors a set of people; neither is changed by being re-read."""
    reordered_dates = plan(marketDates=[{"date": "2026-08-02"}, {"date": "2026-08-01"}])
    assert prints(setup=reordered_dates) == prints()
    two = [vendor(), vendor("app-2")]
    assert prints(vendors=two) == prints(vendors=list(reversed(two)))


# --- What the market says ---------------------------------------------------------------------


@pytest.fixture
def market_with(monkeypatch):
    """A market in `assignment` with a stored assignment, and the approved vendors it now has."""

    def build(made_from, setup=PLAN, vendors=None, history=ONCE):
        doc = stored_market(
            phase=MarketPhase.ASSIGNMENT,
            setupObject=setup,
            phaseHistory=[{"phase": phase, "enteredAt": "2026-01-01T00:00:00Z"} for phase in history],
        )
        doc["assignmentObject"]["vendorAssignments"] = [
            {
                "email": "app-1@example.com",
                "date": "2026-08-01",
                "tableCode": "Hall A 1",
                "tableChoice": "Full Table",
                "section": "Hall A",
                "tier": "Gold",
                "location": "Main Hall",
            }
        ]
        if made_from is not None:
            doc["assignmentObject"]["madeFrom"] = made_from
        monkeypatch.setattr(
            MadeFrom,
            "approved_solver_vendors",
            lambda _market_id, _options: (vendors if vendors is not None else [vendor()], []),
        )
        return MarketsApi.market_from_document(doc)

    return build


def test_right_after_a_run_nothing_has_changed(market_with):
    assert MadeFrom.changed_since_run(market_with(prints())) == []


def test_it_names_exactly_the_groups_that_changed(market_with):
    changed_plan = {**PLAN, "priority": []}
    market = market_with(prints(), setup=changed_plan, vendors=[vendor(), vendor("app-2")])
    assert MadeFrom.changed_since_run(market) == ["rules", "applications"]


def test_changing_a_thing_back_is_up_to_date_again(market_with):
    assert MadeFrom.changed_since_run(market_with(prints(), setup={**PLAN})) == []


def test_the_review_reopened_since_the_run_is_named(market_with):
    again = ONCE + ("applications", "assignment")
    market = market_with(prints(), history=again)
    assert MadeFrom.changed_since_run(market) == ["review"]
    assert MadeFrom.review_reopened_since_run(market)


def test_it_names_the_review_last_beside_the_others(market_with):
    again = ONCE + ("applications", "assignment")
    market = market_with(prints(), vendors=[vendor(), vendor("app-2")], history=again)
    assert MadeFrom.changed_since_run(market) == ["applications", "review"]


def test_a_run_after_the_review_reopened_is_up_to_date(market_with):
    again = ONCE + ("applications", "assignment")
    market = market_with(prints(history=again), history=again)
    assert MadeFrom.changed_since_run(market) == []
    assert not MadeFrom.review_reopened_since_run(market)


def test_a_run_recorded_without_the_review_is_not_out_of_date_by_it(market_with):
    """Runs before the group existed record three groups; the review is not known to have moved."""
    before_the_group = {group: value for group, value in prints().items() if group != "review"}
    market = market_with(before_the_group, history=ONCE + ("applications", "assignment"))
    assert MadeFrom.changed_since_run(market) == []
    assert not MadeFrom.review_reopened_since_run(market)


def test_whether_the_review_reopened_reads_no_application(market_with, monkeypatch):
    """The go-live guard asks it, so it reads the phase record and the run's record of it only."""
    market = market_with(prints(), history=ONCE + ("applications", "assignment"))

    def refuse(*_args):
        raise AssertionError("read the approved applications")

    monkeypatch.setattr(MadeFrom, "approved_solver_vendors", refuse)
    assert MadeFrom.review_reopened_since_run(market)


def test_an_assignment_from_before_fingerprints_is_not_known_to_be_out_of_date(market_with):
    """A notice on every existing market would teach organizers to ignore it."""
    assert MadeFrom.changed_since_run(market_with(None, setup={**PLAN, "priority": []})) == []


# --- The run records it -----------------------------------------------------------------------


def test_a_run_records_what_it_was_made_from(monkeypatch):
    fake = FakeMarketsCollection(stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=PLAN))
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    vendors = [vendor()]
    monkeypatch.setattr(PlacementsApi, "solver_vendors_for", lambda _market: vendors)

    def fake_assign(market, _vendors=None):
        market.assignment_object = AssignmentObject(
            vendor_assignments=[
                VendorAssignmentResult(
                    email="app-1@example.com",
                    date="2026-08-01",
                    table_code="Hall A 1",
                    table_choice="Full Table",
                    section="Hall A",
                    tier="Gold",
                    location="Main Hall",
                )
            ],
            assignment_date="2026-07-01T00:00:00",
        )
        return market

    monkeypatch.setattr(PlacementsApi, "assign_market", fake_assign)

    _result, status = PlacementsApi.run_assignment("market-123", "user-1")

    assert status == 200
    assert fake.last_update["$set"]["assignmentObject.madeFrom"] == MadeFrom.fingerprint(
        plan(), vendors, []
    )


def test_a_hand_placement_leaves_what_the_run_was_made_from_alone(monkeypatch):
    fake = FakeMarketsCollection(stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=PLAN))
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    monkeypatch.setattr(PlacementsApi, "has_applied", lambda _market_id, _address: True)

    PlacementsApi.write_placement(
        "market-123",
        {"email": "ana@example.com", "date": "2026-08-01", "table_code": "Hall A 1", "table_choice": "Full Table"},
        "user-1",
    )

    assert "assignmentObject.madeFrom" not in fake.last_update["$set"]


def test_a_run_made_before_extra_share_addresses_existed_still_matches():
    """E27 gave the solver's input the further addresses a table-share answer names. A vendor who
    named none fingerprints exactly as before, or every stored assignment would read as out of date.

    The literal is what the build before E27 computed for this vendor.
    """
    assert prints()["applications"] == (
        "fe3cddcf1025e300d75e0147bf2c4d3412d04d3388c1187b8e417b83a07b093e"
    )


def test_further_share_addresses_are_part_of_what_a_run_was_made_from():
    assert prints(vendors=[vendor(table_share_also=("pal@example.com",))]) != prints()
