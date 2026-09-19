"""One endpoint writes one placement, and it is the only thing that may (E11/F01/S01).

``assignmentObject.vendorAssignments`` decides where a vendor stands on the day, so what is
pinned here is not only that the write works but that it derives every field it can from the
market's own plan rather than believing the request.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market

import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
from datatypes import MarketRole


SETUP_OBJECT = {
    "priority": [],
    "marketDates": [{"date": "2026-08-01"}, {"date": "2026-08-02"}],
    "tiers": [{"id": 1, "name": "Gold"}, {"id": 2, "name": "Silver"}],
    "locations": [{"name": "Main Hall"}],
    "sections": [
        {
            "name": "Hall A",
            "location": {"name": "Main Hall"},
            "tier": {"id": 1, "name": "Gold"},
            "count": 2,
        },
        {
            "name": "Garden",
            "location": {"name": "Main Hall"},
            "tier": {"id": 2, "name": "Silver"},
            "count": 1,
        },
    ],
    "assignmentOptions": {"maxAssignmentsPerVendor": 2, "maxHalfTableProportionPerSection": 50},
}


def placement(**overrides) -> dict:
    body = {
        "email": "ana@example.com",
        "date": "2026-08-01",
        "table_code": "Hall A 1",
        "table_choice": "Full Table",
    }
    body.update(overrides)
    return body


@pytest.fixture
def collection(monkeypatch):
    fake = FakeMarketsCollection(stored_market(setupObject=SETUP_OBJECT))
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_args, **_kwargs: True)
    return fake


def written_placements(collection) -> list:
    return collection.last_update["$set"]["assignmentObject.vendorAssignments"]


def already_placed(collection, *rows) -> None:
    """Seed the stored assignment. The fake collection records writes without applying them, so
    a test about what a write preserves has to say what was there before it."""
    collection.doc["assignmentObject"]["vendorAssignments"] = [
        {
            "email": email,
            "date": date,
            "tableCode": table_code,
            "tableChoice": "Full Table",
            "section": "Hall A",
            "tier": "Gold",
            "location": "Main Hall",
        }
        for email, date, table_code in rows
    ]


def test_a_placement_is_written(collection):
    result, status = PlacementsApi.write_placement("market-123", placement(), "user-1")

    assert status == 200
    assert written_placements(collection) == [
        {
            "email": "ana@example.com",
            "date": "2026-08-01",
            "tableCode": "Hall A 1",
            "tableChoice": "Full Table",
            "section": "Hall A",
            "tier": "Gold",
            "location": "Main Hall",
            "handPlaced": True,
        }
    ]
    assert result["placement"]["tableCode"] == "Hall A 1"


def test_the_section_tier_and_location_come_from_the_plan_not_the_request(collection):
    """Tier sets the price, so a request may not name one the organizer did not give that table."""
    PlacementsApi.write_placement(
        "market-123",
        placement(table_code="Garden 1", section="Hall A", tier="Gold", location="Elsewhere"),
        "user-1",
    )

    written = written_placements(collection)[0]
    assert (written["section"], written["tier"], written["location"]) == (
        "Garden",
        "Silver",
        "Main Hall",
    )


def test_a_second_placement_on_the_same_date_moves_the_vendor(collection):
    """A vendor holds at most one seat per date, so placing them again moves them."""
    already_placed(collection, ("ana@example.com", "2026-08-01", "Hall A 1"))

    PlacementsApi.write_placement("market-123", placement(table_code="Hall A 2"), "user-1")

    assert [row["tableCode"] for row in written_placements(collection)] == ["Hall A 2"]


def test_a_placement_on_another_date_is_a_second_placement(collection):
    already_placed(collection, ("ana@example.com", "2026-08-01", "Hall A 1"))

    PlacementsApi.write_placement("market-123", placement(date="2026-08-02"), "user-1")

    assert [row["date"] for row in written_placements(collection)] == [
        "2026-08-01",
        "2026-08-02",
    ]


def test_another_vendors_placement_is_left_alone(collection):
    already_placed(collection, ("ana@example.com", "2026-08-01", "Hall A 1"))

    PlacementsApi.write_placement(
        "market-123", placement(email="ben@example.com", table_code="Hall A 2"), "user-1"
    )

    assert sorted(row["email"] for row in written_placements(collection)) == [
        "ana@example.com",
        "ben@example.com",
    ]


def test_statistics_are_never_written_back(collection):
    PlacementsApi.write_placement("market-123", placement(), "user-1")

    assert collection.last_update["$set"]["assignmentObject.assignmentStatistics"] is None


@pytest.mark.parametrize(
    "overrides, expected",
    [
        ({"date": "2026-09-09"}, "not one of this market's dates"),
        ({"table_code": "Hall A 3"}, "no table 'Hall A 3'"),
        ({"table_code": "Nowhere 1"}, "no table 'Nowhere 1'"),
        ({"table_choice": "Whole Table"}, "is not a seat"),
        ({"email": ""}, "must name the vendor"),
    ],
)
def test_a_placement_the_plan_cannot_hold_is_refused(collection, overrides, expected):
    with pytest.raises(PlacementsApi.PlacementError) as refusal:
        PlacementsApi.write_placement("market-123", placement(**overrides), "user-1")

    assert expected in str(refusal.value)
    assert collection.last_update is None


def test_every_seat_of_a_table_may_be_named(collection):
    """A table holds two seats, so a placement always names a side."""
    for seat in PlacementsApi.TABLE_CHOICES:
        PlacementsApi.write_placement("market-123", placement(table_choice=seat), "user-1")
        assert written_placements(collection)[0]["tableChoice"] == seat


def test_a_market_with_no_plan_has_no_seats(monkeypatch):
    fake = FakeMarketsCollection(stored_market())
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_args, **_kwargs: True)

    with pytest.raises(PlacementsApi.PlacementError):
        PlacementsApi.write_placement("market-123", placement(), "user-1")


def test_a_viewer_is_refused_and_an_editor_is_not(monkeypatch):
    """The same bar as every other market write - an EDITOR already owns the whole plan."""
    fake = FakeMarketsCollection(stored_market(setupObject=SETUP_OBJECT))
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)

    asked_for = []

    def only_viewer(_user, _market, role, _organization=None):
        asked_for.append(role)
        return role == MarketRole.VIEWER

    monkeypatch.setattr(PermissionsApi, "user_has_permission", only_viewer)

    with pytest.raises(PermissionError):
        PlacementsApi.write_placement("market-123", placement(), "user-1")

    assert asked_for == [MarketRole.EDITOR]

    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    _result, status = PlacementsApi.write_placement("market-123", placement(), "user-1")
    assert status == 200


def test_an_absent_market_is_not_found(monkeypatch):
    fake = FakeMarketsCollection(None)
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)

    with pytest.raises(MarketsApi.MarketNotFoundError):
        PlacementsApi.write_placement("market-123", placement(), "user-1")


def test_a_solver_run_stores_what_it_produced(collection, monkeypatch):
    """The write half of ``GET /markets/<id>/assignment``.

    The browser used to store a run by PUTting the whole market back with the result it had been
    handed. With ``assignmentObject`` server-owned that PUT stores nothing, so the run itself has
    to persist - otherwise Assign computes an assignment and throws it away.
    """
    from datatypes import AssignmentObject, VendorAssignmentResult

    produced = VendorAssignmentResult(
        email="ana@example.com",
        date="2026-08-01",
        table_code="Hall A 1",
        table_choice="Full Table",
        section="Hall A",
        tier="Gold",
        location="Main Hall",
    )

    def fake_assign(market, _vendors=None):
        market.assignment_object = AssignmentObject(
            vendor_assignments=[produced], assignment_date="2026-07-01T00:00:00"
        )
        return market

    monkeypatch.setattr(PlacementsApi, "solver_vendors_for", lambda _market: ["a vendor"])
    monkeypatch.setattr(PlacementsApi, "assign_market", fake_assign)

    result, status = PlacementsApi.run_assignment("market-123", "user-1")

    assert status == 200
    assert written_placements(collection)[0]["email"] == "ana@example.com"
    assert collection.last_update["$set"]["assignmentObject.assignmentDate"] == (
        "2026-07-01T00:00:00"
    )
    # The same shape the GET returns, so a caller swapping to this one reads it the same way.
    assert result["assignmentObject"]["vendorAssignments"][0]["tableCode"] == "Hall A 1"


def test_a_solver_run_over_nobody_is_refused_and_stores_nothing(collection, monkeypatch):
    """A run over nobody produces a screen indistinguishable from a run that failed."""
    monkeypatch.setattr(PlacementsApi, "solver_vendors_for", lambda _market: [])

    result, status = PlacementsApi.run_assignment("market-123", "user-1")

    assert status == 400
    assert result["error"] == PlacementsApi.NOTHING_TO_ASSIGN
    assert collection.last_update is None


def test_a_solver_run_names_the_applicants_whose_answers_are_missing(collection, monkeypatch):
    from assignment.assignment import IncompleteApplicationsError
    from assignment.vendor_input import IncompleteApplication

    def refuse(_market):
        raise IncompleteApplicationsError(
            [IncompleteApplication("app-1", "ana@example.com", ("Table choice",))]
        )

    monkeypatch.setattr(PlacementsApi, "solver_vendors_for", refuse)

    result, status = PlacementsApi.run_assignment("market-123", "user-1")

    assert status == 400
    assert "ana@example.com" in result["error"]
    assert collection.last_update is None


def test_a_solver_run_needs_edit_permission(monkeypatch):
    fake = FakeMarketsCollection(stored_market(setupObject=SETUP_OBJECT))
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: False)

    with pytest.raises(PermissionError):
        PlacementsApi.run_assignment("market-123", "user-1")


def test_a_solver_run_needs_a_plan(monkeypatch):
    fake = FakeMarketsCollection(stored_market())
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)

    result, status = PlacementsApi.run_assignment("market-123", "user-1")

    assert status == 400
    assert "setup" in result["error"].lower()


def test_a_solver_run_carries_the_organization_name(collection, monkeypatch):
    """The browser replaces the market it holds with this response, and the summary card reads it."""
    collection.doc["organizationId"] = "org-1"
    monkeypatch.setattr(
        MarketsApi,
        "_load_organization_context",
        lambda _org_id: (None, {"name": "Seed Test Org"}),
    )
    monkeypatch.setattr(PlacementsApi, "solver_vendors_for", lambda _market: ["a vendor"])
    monkeypatch.setattr(
        PlacementsApi, "assign_market", lambda market, _v=None: market
    )

    result, _status = PlacementsApi.run_assignment("market-123", "user-1")

    assert result["organizationName"] == "Seed Test Org"
