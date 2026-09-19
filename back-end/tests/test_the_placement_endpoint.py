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
from datatypes import MarketPhase, MarketRole


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
    # `assignment`, because that is the one phase the solver runs in (E10/F03/S02). Placements
    # themselves are not phase-gated - admins edit without restriction - so the stories about
    # them are unaffected by which phase this market sits in.
    fake = FakeMarketsCollection(
        stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=SETUP_OBJECT)
    )
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
    fake = FakeMarketsCollection(
        stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=SETUP_OBJECT)
    )
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
    fake = FakeMarketsCollection(
        stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=SETUP_OBJECT)
    )
    monkeypatch.setattr(MarketsApi, "markets_collection", fake)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: False)

    with pytest.raises(PermissionError):
        PlacementsApi.run_assignment("market-123", "user-1")


def test_a_solver_run_needs_a_plan(monkeypatch):
    fake = FakeMarketsCollection(stored_market(phase=MarketPhase.ASSIGNMENT))
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


class TestASecondPinToAnOccupiedSeat:
    """A contradiction, not a preference the solver can weigh - refused while both are visible."""

    def test_the_refusal_names_the_vendor_already_there(self, collection):
        already_placed(collection, ("ana@example.com", "2026-08-01", "Hall A 1"))

        with pytest.raises(PlacementsApi.SeatTakenError) as refusal:
            PlacementsApi.write_placement(
                "market-123", placement(email="ben@example.com"), "user-1"
            )

        assert "ana@example.com" in str(refusal.value)
        assert "Hall A 1" in str(refusal.value)
        assert collection.last_update is None

    def test_the_vendor_already_there_may_still_be_moved_within_their_own_seat(self, collection):
        """Their own row is replaced, not collided with."""
        already_placed(collection, ("ana@example.com", "2026-08-01", "Hall A 1"))

        _result, status = PlacementsApi.write_placement(
            "market-123", placement(table_choice="Half Table (Left)"), "user-1"
        )

        assert status == 200

    def test_the_other_half_of_a_shared_table_is_somebody_elses_business(self, collection):
        collection.doc["assignmentObject"]["vendorAssignments"] = [
            {
                "email": "ana@example.com", "date": "2026-08-01", "tableCode": "Hall A 1",
                "tableChoice": "Half Table (Left)", "section": "Hall A", "tier": "Gold",
                "location": "Main Hall", "handPlaced": True,
            }
        ]

        _result, status = PlacementsApi.write_placement(
            "market-123",
            placement(email="ben@example.com", table_choice="Half Table (Right)"),
            "user-1",
        )

        assert status == 200

    def test_a_whole_table_needs_both_seats(self, collection):
        collection.doc["assignmentObject"]["vendorAssignments"] = [
            {
                "email": "ana@example.com", "date": "2026-08-01", "tableCode": "Hall A 1",
                "tableChoice": "Half Table (Left)", "section": "Hall A", "tier": "Gold",
                "location": "Main Hall", "handPlaced": True,
            }
        ]

        with pytest.raises(PlacementsApi.SeatTakenError):
            PlacementsApi.write_placement(
                "market-123", placement(email="ben@example.com"), "user-1"
            )

    def test_a_half_cannot_be_squeezed_beside_a_whole_table(self, collection):
        already_placed(collection, ("ana@example.com", "2026-08-01", "Hall A 1"))

        with pytest.raises(PlacementsApi.SeatTakenError):
            PlacementsApi.write_placement(
                "market-123",
                placement(email="ben@example.com", table_choice="Half Table (Right)"),
                "user-1",
            )

    def test_the_same_seat_on_another_date_is_another_seat(self, collection):
        already_placed(collection, ("ana@example.com", "2026-08-01", "Hall A 1"))

        _result, status = PlacementsApi.write_placement(
            "market-123", placement(email="ben@example.com", date="2026-08-02"), "user-1"
        )

        assert status == 200


class TestFreeingASeat:
    """The operation every safe change is built on: no move displaces an occupant."""

    def test_a_placement_is_removed(self, collection):
        already_placed(
            collection,
            ("ana@example.com", "2026-08-01", "Hall A 1"),
            ("ben@example.com", "2026-08-01", "Hall A 2"),
        )

        result, status = PlacementsApi.remove_placement(
            "market-123", "ana@example.com", "2026-08-01", "user-1"
        )

        assert (status, result) == (200, {"removed": 1})
        assert [row["email"] for row in written_placements(collection)] == ["ben@example.com"]

    def test_removing_a_seat_nobody_holds_is_not_an_error(self, collection):
        """The caller asked for that seat to be empty, and it is."""
        result, status = PlacementsApi.remove_placement(
            "market-123", "nobody@example.com", "2026-08-01", "user-1"
        )

        assert (status, result) == (200, {"removed": 0})
        assert collection.last_update is None

    def test_removing_needs_edit_permission(self, monkeypatch):
        fake = FakeMarketsCollection(
        stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=SETUP_OBJECT)
    )
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: False)

        with pytest.raises(PermissionError):
            PlacementsApi.remove_placement(
                "market-123", "ana@example.com", "2026-08-01", "user-1"
            )

    def test_removing_must_name_a_vendor_and_a_date(self, collection):
        with pytest.raises(PlacementsApi.PlacementError):
            PlacementsApi.remove_placement("market-123", "", "2026-08-01", "user-1")


class TestSwappingTwoVendors:
    """One action, both rows, or neither (E11/F03/S01)."""

    def _two_seated(self, collection):
        collection.doc["assignmentObject"]["vendorAssignments"] = [
            {
                "email": "ana@example.com", "date": "2026-08-01", "tableCode": "Hall A 1",
                "tableChoice": "Full Table", "section": "Hall A", "tier": "Gold",
                "location": "Main Hall", "handPlaced": False,
            },
            {
                "email": "ben@example.com", "date": "2026-08-01", "tableCode": "Garden 1",
                "tableChoice": "Half Table (Left)", "section": "Garden", "tier": "Silver",
                "location": "Main Hall", "handPlaced": False,
            },
        ]

    def test_the_two_vendors_trade_seats(self, collection):
        self._two_seated(collection)

        _result, status = PlacementsApi.swap_placements(
            "market-123", "2026-08-01", "ana@example.com", "ben@example.com", "user-1"
        )

        assert status == 200
        seats = {row["email"]: (row["tableCode"], row["tableChoice"], row["tier"])
                 for row in written_placements(collection)}
        assert seats["ana@example.com"] == ("Garden 1", "Half Table (Left)", "Silver")
        assert seats["ben@example.com"] == ("Hall A 1", "Full Table", "Gold")

    def test_both_sides_of_a_swap_are_hand_placed(self, collection):
        """A swap is two deliberate placements, so the solver must work around both."""
        self._two_seated(collection)

        PlacementsApi.swap_placements(
            "market-123", "2026-08-01", "ana@example.com", "ben@example.com", "user-1"
        )

        assert all(row["handPlaced"] for row in written_placements(collection))

    def test_a_vendor_holding_no_table_that_day_cannot_be_swapped(self, collection):
        """Nothing is written, so there is no half-finished state to recover from."""
        self._two_seated(collection)

        with pytest.raises(PlacementsApi.PlacementError) as refusal:
            PlacementsApi.swap_placements(
                "market-123", "2026-08-01", "ana@example.com", "nobody@example.com", "user-1"
            )

        assert "nobody@example.com" in str(refusal.value)
        assert collection.last_update is None

    def test_a_vendor_cannot_swap_with_themselves(self, collection):
        self._two_seated(collection)

        with pytest.raises(PlacementsApi.PlacementError):
            PlacementsApi.swap_placements(
                "market-123", "2026-08-01", "ana@example.com", "ana@example.com", "user-1"
            )

    def test_placements_on_other_dates_are_untouched(self, collection):
        self._two_seated(collection)
        collection.doc["assignmentObject"]["vendorAssignments"].append({
            "email": "ana@example.com", "date": "2026-08-02", "tableCode": "Hall A 2",
            "tableChoice": "Full Table", "section": "Hall A", "tier": "Gold",
            "location": "Main Hall", "handPlaced": False,
        })

        PlacementsApi.swap_placements(
            "market-123", "2026-08-01", "ana@example.com", "ben@example.com", "user-1"
        )

        other_day = [row for row in written_placements(collection) if row["date"] == "2026-08-02"]
        assert [row["tableCode"] for row in other_day] == ["Hall A 2"]

    def test_swapping_needs_edit_permission(self, monkeypatch):
        fake = FakeMarketsCollection(
        stored_market(phase=MarketPhase.ASSIGNMENT, setupObject=SETUP_OBJECT)
    )
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: False)

        with pytest.raises(PermissionError):
            PlacementsApi.swap_placements(
                "market-123", "2026-08-01", "ana@example.com", "ben@example.com", "user-1"
            )


class TestAssignRunsInItsPhaseAndNowhereElse:
    """E10/F03/S02, unblocked by E11: a frozen solver strands nobody now that a placement can be
    hand-changed from the Tables view."""

    def _market(self, monkeypatch, phase):
        fake = FakeMarketsCollection(stored_market(phase=phase, setupObject=SETUP_OBJECT))
        monkeypatch.setattr(MarketsApi, "markets_collection", fake)
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
        monkeypatch.setattr(PlacementsApi, "solver_vendors_for", lambda _m: ["a vendor"])
        monkeypatch.setattr(PlacementsApi, "assign_market", lambda m, _v=None: m)
        return fake

    @pytest.mark.parametrize("phase", [
        MarketPhase.DRAFT,
        MarketPhase.APPLICATIONS_OPEN,
        MarketPhase.APPLICATIONS_CLOSED,
        MarketPhase.REVIEW,
        MarketPhase.OFFERS,
        MarketPhase.MARKET_DAYS,
        MarketPhase.ARCHIVED,
    ])
    def test_the_endpoint_refuses_outside_assignment(self, monkeypatch, phase):
        """The endpoint is reachable directly, so a hidden button is not the rule."""
        fake = self._market(monkeypatch, phase)

        with pytest.raises(PlacementsApi.AssignPhaseError):
            PlacementsApi.run_assignment("market-123", "user-1")

        assert fake.last_update is None

    def test_it_runs_in_assignment(self, monkeypatch):
        self._market(monkeypatch, MarketPhase.ASSIGNMENT)

        _result, status = PlacementsApi.run_assignment("market-123", "user-1")

        assert status == 200

    def test_re_running_inside_assignment_is_allowed(self, monkeypatch):
        """An organizer who changes the plan or approves a late application needs a fresh answer,
        and there is nothing to protect yet."""
        self._market(monkeypatch, MarketPhase.ASSIGNMENT)

        first = PlacementsApi.run_assignment("market-123", "user-1")
        second = PlacementsApi.run_assignment("market-123", "user-1")

        assert (first[1], second[1]) == (200, 200)

    @pytest.mark.parametrize("phase, names", [
        (MarketPhase.DRAFT, "draft"),
        (MarketPhase.APPLICATIONS_OPEN, "Close them"),
        (MarketPhase.REVIEW, "review"),
        (MarketPhase.MARKET_DAYS, "Tables view"),
    ])
    def test_the_refusal_names_an_action_available_from_that_phase(self, phase, names):
        assert names in PlacementsApi.assign_phase_refusal(phase)

    def test_the_rule_does_not_repeat_the_guards_around_it(self):
        """`_ALL_REVIEWED` and `_ASSIGNMENT_COMPUTED` are said once each, in guards.py."""
        import inspect

        source = inspect.getsource(PlacementsApi.assign_phase_refusal)
        assert "ApplicationStatus" not in source
        assert "vendor_assignments" not in source
