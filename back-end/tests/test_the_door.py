"""The door on market day (E29/F01): who is expected, who has arrived, and an organizer's check-in.

Attendance listed only the vendors who had checked in, by email, so on a day with 80 vendors the
organizer at the door could not say who was missing (known gap 3). The roster is read off the
stored assignment - the same rows check-in records against - so the two can never disagree about
who was expected where.
"""
import pytest

from conftest import FakeMarketsCollection, stored_market
from test_attendance_api import FakeAttendanceCollection

import api.applications as ApplicationsApi
import api.attendance as AttendanceApi
import api.door as DoorApi
import api.markets as MarketsApi
import api.permissions as PermissionsApi
from client_errors import ForbiddenError
from datatypes import MarketPhase, MarketRole

D1, D2 = "2026-11-18", "2026-11-19"


def seat(email, date, table_code, table_choice="Full Table", section="A", location="Upper Atrium"):
    return {
        "email": email,
        "date": date,
        "tableCode": table_code,
        "tableChoice": table_choice,
        "section": section,
        "tier": "Gold",
        "location": location,
    }


def market(phase=MarketPhase.MARKET_DAYS, seats=()):
    return stored_market(
        phase=phase,
        setupObject={
            "priority": [],
            # Out of order on purpose: the roster lists them as a calendar does.
            "marketDates": [{"date": D2}, {"date": D1}],
            "tiers": [{"id": 0, "name": "Gold"}, {"id": 1, "name": "Silver"}],
            "locations": [{"name": "Upper Atrium"}, {"name": "Lower Atrium"}],
            "sections": [
                {"name": "A", "location": {"name": "Upper Atrium"},
                 "tier": {"id": 0, "name": "Gold"}, "count": 31},
                {"name": "B", "location": {"name": "Lower Atrium"},
                 "tier": {"id": 1, "name": "Silver"}, "count": 28},
            ],
            "assignmentOptions": {
                "maxAssignmentsPerVendor": None, "maxHalfTableProportionPerSection": None,
            },
        },
        assignmentObject={"vendorAssignments": list(seats)},
    )


@pytest.fixture
def door(monkeypatch):
    """A running market, its check-ins, and an organizer allowed whatever the test grants."""
    state = {"granted": True, "asked": []}
    markets = FakeMarketsCollection(market(seats=[
        seat("ana@example.com", D1, "A 2"),
        seat("ben@example.com", D1, "A 1", "Half Table (Left)"),
        seat("cy@example.com", D1, "A 1", "Half Table (Right)"),
        seat("ana@example.com", D2, "B 5", section="B", location="Lower Atrium"),
    ]))
    attendance = FakeAttendanceCollection()

    def permission(user, _market, role, _org=None):
        state["asked"].append(role)
        return state["granted"]

    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(AttendanceApi, "markets_collection", markets)
    monkeypatch.setattr(AttendanceApi, "attendance_collection", attendance)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", permission)
    monkeypatch.setattr(
        ApplicationsApi, "vendor_names_for_market", lambda _id: {"ana@example.com": "Ana"},
    )
    state.update(markets=markets, attendance=attendance)
    return state


class TestTheRoster:
    def test_lists_every_vendor_placed_on_each_date_whether_or_not_they_came(self, door):
        roster = AttendanceApi.attendance_roster(door["markets"].doc)

        assert roster["dates"] == [D1, D2]
        assert [(r["date"], r["vendorEmail"], r["tableCode"]) for r in roster["roster"]] == [
            (D1, "ben@example.com", "A 1"),
            (D1, "cy@example.com", "A 1"),
            (D1, "ana@example.com", "A 2"),
            (D2, "ana@example.com", "B 5"),
        ]
        assert all(r["checkedInAt"] is None for r in roster["roster"])

    def test_says_who_they_are_where_they_sit_and_when_they_came(self, door):
        AttendanceApi.record_attendance("market-123", "ana@example.com", D1)

        row = next(
            r for r in AttendanceApi.attendance_roster(door["markets"].doc)["roster"]
            if r["vendorEmail"] == "ana@example.com" and r["date"] == D1
        )
        assert row["vendorName"] == "Ana"
        assert (row["section"], row["location"], row["tableChoice"]) == (
            "A", "Upper Atrium", "Full Table",
        )
        assert row["checkedInAt"]
        # The vendor checked themselves in: nobody else is named.
        assert row["checkedInBy"] is None

    def test_a_vendor_with_no_name_is_still_listed_by_address(self, door):
        row = next(
            r for r in AttendanceApi.attendance_roster(door["markets"].doc)["roster"]
            if r["vendorEmail"] == "ben@example.com"
        )
        assert row["vendorName"] == ""


class TestAnOrganizerChecksAVendorIn:
    def test_the_check_in_records_who_made_it(self, door):
        result, status = DoorApi.check_in("market-123", "ben@example.com", D1, "door@example.com")

        assert status == 200, result
        stored = door["attendance"].docs[0]
        assert (stored["vendor_email"], stored["date"]) == ("ben@example.com", D1)
        assert stored["checked_in_by"] == "door@example.com"
        assert MarketRole.EDITOR in door["asked"]

    def test_a_vendor_checking_in_again_clears_the_organizer_s_name(self, door):
        DoorApi.check_in("market-123", "ben@example.com", D1, "door@example.com")
        AttendanceApi.record_attendance("market-123", "ben@example.com", D1)

        assert door["attendance"].docs[0]["checked_in_by"] is None

    def test_an_organizer_can_undo_it(self, door):
        DoorApi.check_in("market-123", "ben@example.com", D1, "door@example.com")

        result, status = DoorApi.undo_check_in("market-123", "ben@example.com", D1, "door@example.com")

        assert status == 200, result
        assert door["attendance"].docs == []

    def test_a_vendor_not_placed_that_day_cannot_be_checked_in(self, door):
        result, status = DoorApi.check_in("market-123", "ben@example.com", D2, "door@example.com")

        assert status == 404
        assert door["attendance"].docs == []

    def test_someone_who_cannot_edit_the_market_is_refused(self, door):
        door["granted"] = False

        with pytest.raises(ForbiddenError):
            DoorApi.check_in("market-123", "ben@example.com", D1, "viewer@example.com")
        assert door["attendance"].docs == []

    @pytest.mark.parametrize("phase", [MarketPhase.ASSIGNMENT, MarketPhase.APPLICATIONS])
    def test_nobody_is_checked_in_before_the_market_is_published(self, door, phase):
        door["markets"].doc["phase"] = phase.value

        result, status = DoorApi.check_in("market-123", "ben@example.com", D1, "door@example.com")

        assert status == 409
        assert "published" in result["error"]
        assert door["attendance"].docs == []

    def test_an_archived_market_s_record_is_not_changed(self, door):
        door["markets"].doc["phase"] = MarketPhase.ARCHIVED.value

        with pytest.raises(MarketsApi.MarketArchivedError):
            DoorApi.check_in("market-123", "ben@example.com", D1, "door@example.com")
        with pytest.raises(MarketsApi.MarketArchivedError):
            DoorApi.undo_check_in("market-123", "ben@example.com", D1, "door@example.com")
