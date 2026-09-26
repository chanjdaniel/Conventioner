"""The result knows what it was made from (E22/F03/S01).

Editing the rules, the plan or the approved applications never changes a stored assignment - only
running it again does. So each run records a fingerprint of each of the three things the solver
read, and the market says which of them has changed since. Hand placements are not an input: they
are edits to the result, so they never make it out of date.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import assignment.made_from as MadeFrom
from assignment.utils import convert_keys_to_snake_case
from assignment.vendor_input import SolverVendor
from datatypes import AssignmentObject, MarketPhase, SetupObject, VendorAssignmentResult


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


def prints(setup=None, vendors=None):
    return MadeFrom.fingerprint(setup or plan(), vendors if vendors is not None else [vendor()])


# --- The fingerprint: one per group, and only its own group moves ---------------------------


def test_the_same_inputs_are_the_same_fingerprint():
    assert prints() == prints()
    assert set(prints()) == {"rules", "plan", "applications"}


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

    def build(made_from, setup=PLAN, vendors=None):
        doc = stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=setup)
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
        plan(), vendors
    )


def test_a_hand_placement_leaves_what_the_run_was_made_from_alone(monkeypatch):
    fake = FakeMarketsCollection(stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=PLAN))
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)

    PlacementsApi.write_placement(
        "market-123",
        {"email": "ana@example.com", "date": "2026-08-01", "table_code": "Hall A 1", "table_choice": "Full Table"},
        "user-1",
    )

    assert "assignmentObject.madeFrom" not in fake.last_update["$set"]
