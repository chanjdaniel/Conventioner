"""The Stats tab's Check-in: each market day's vendors checked in of those expected, and how many
vendors came on any day (T201).

Counted as the Attendance roster reads them (``attendance_roster``), from the market's stored
assignment rows and its attendance records, by a helper beside it that reads no names
(``check_in_counts``); a check-in by the organizer at the door and one by the vendor on their
vendor page are one kind of record, so both count. ``None`` until the market has reached Market
Days, as nobody checks in before.
"""
import copy

import pytest

from conftest import stored_market
from test_a_vendors_payments import PLAN, LiveMarket
from test_the_payments_page import ANA, BEN, CY, EDITOR, MARKET, SAT, SEATS, SUN

import api.applications as ApplicationsApi
import api.attendance as AttendanceApi
import api.door as Door
import api.markets as MarketsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import market_stats as MarketStats
from datatypes import MarketPhase

#: A record whole from its creation, so it is taken at its word.
REACHED_MARKET_DAYS = ["draft", "applications", "assignment", "market_days"]


def _record(phases):
    return [{"phase": phase, "enteredAt": "2099-04-01T00:00:00+00:00", "by": EDITOR}
            for phase in phases]


@pytest.fixture
def seated(monkeypatch, applications, market_records):
    """Ana on both days, Ben on Saturday and Cy on Sunday, on a market in the phase asked."""
    def on(phase=MarketPhase.MARKET_DAYS, reached=REACHED_MARKET_DAYS):
        # Seated while the market may still be changed, then moved to the phase asked.
        live = LiveMarket(stored_market(
            phase=MarketPhase.MARKET_DAYS, setupObject=copy.deepcopy(PLAN),
            phaseHistory=_record(reached)))
        for module in (MarketsApi, AttendanceApi):
            monkeypatch.setattr(module, "markets_collection", live)
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
        for email in (ANA, BEN, CY):
            applications.insert_one({"id": f"app-{email}", "market_id": MARKET,
                                     "applicant_email": email, "form_data": {},
                                     "status": "reviewer_approved", "application_type": "main"})
        for email, date, table, choice in SEATS:
            PlacementsApi.write_placement(
                MARKET, {"email": email, "date": date, "table_code": table,
                         "table_choice": choice},
                EDITOR)
        live.doc["phase"] = phase.value
        return live
    return on


def stats():
    return MarketStats.stats_for_market(MarketsApi.load_market_context(MARKET).market)


def days(check_in):
    return [(day["date"], day["checkedIn"], day["expected"]) for day in check_in["dates"]]


class TestCheckIn:
    def test_nothing_is_counted_before_the_market_reaches_market_days(self, seated):
        seated(MarketPhase.ASSIGNMENT, reached=["draft", "applications", "assignment"])

        assert stats()["checkIn"] is None

    def test_an_archived_market_that_never_ran_counts_nothing(self, seated):
        seated(MarketPhase.ARCHIVED, reached=["draft", "applications", "archived"])

        assert stats()["checkIn"] is None

    def test_each_day_counts_its_vendors_expected_before_anyone_comes(self, seated):
        seated()

        assert stats()["checkIn"] == {
            "dates": [{"date": SAT, "expected": 2, "checkedIn": 0},
                      {"date": SUN, "expected": 2, "checkedIn": 0}],
            "came": 0,
        }

    def test_a_check_in_at_the_door_and_one_on_the_vendor_page_both_count(self, seated):
        seated()
        # Ben at the door, by the organizer; Cy on their vendor page with the door code.
        Door.check_in(MARKET, BEN, SAT, EDITOR)
        AttendanceApi.record_attendance(MARKET, CY, SUN, via=AttendanceApi.VIA_DOOR_CODE)

        check_in = stats()["checkIn"]

        assert days(check_in) == [(SAT, 1, 2), (SUN, 1, 2)]
        assert check_in["came"] == 2

    def test_a_vendor_on_two_days_checked_in_on_one_is_not_yet_in_on_the_other(self, seated):
        seated()
        AttendanceApi.record_attendance(MARKET, ANA, SAT, checked_in_by=EDITOR)

        check_in = stats()["checkIn"]

        assert days(check_in) == [(SAT, 1, 2), (SUN, 0, 2)]
        assert check_in["came"] == 1

    def test_came_counts_a_vendor_who_came_on_both_days_once(self, seated):
        seated()
        for date in (SAT, SUN):
            AttendanceApi.record_attendance(MARKET, ANA, date, checked_in_by=EDITOR)
        AttendanceApi.record_attendance(MARKET, BEN, SAT, checked_in_by=EDITOR)

        check_in = stats()["checkIn"]

        assert days(check_in) == [(SAT, 2, 2), (SUN, 1, 2)]
        assert check_in["came"] == 2

    def test_an_undone_check_in_does_not_count(self, seated):
        seated()
        AttendanceApi.record_attendance(MARKET, BEN, SAT, checked_in_by=EDITOR)
        AttendanceApi.undo_attendance(MARKET, BEN, SAT, undone_by=EDITOR)

        assert stats()["checkIn"]["came"] == 0

    def test_an_archived_market_that_ran_keeps_its_counts(self, seated):
        seated(MarketPhase.ARCHIVED, reached=[*REACHED_MARKET_DAYS, "archived"])
        AttendanceApi.record_attendance(MARKET, ANA, SUN, checked_in_by=EDITOR)

        check_in = stats()["checkIn"]

        assert days(check_in) == [(SAT, 0, 2), (SUN, 1, 2)]
        assert check_in["came"] == 1

    def test_each_day_agrees_with_the_attendance_roster(self, seated):
        live = seated()
        AttendanceApi.record_attendance(MARKET, ANA, SAT, checked_in_by=EDITOR)
        AttendanceApi.record_attendance(MARKET, CY, SUN, via=AttendanceApi.VIA_DOOR_CODE)

        roster = AttendanceApi.attendance_roster(live.doc)

        assert days(stats()["checkIn"]) == [
            (date,
             sum(1 for row in roster["roster"] if row["date"] == date and row["checkedInAt"]),
             sum(1 for row in roster["roster"] if row["date"] == date))
            for date in roster["dates"]
        ]

    def test_the_count_reads_no_vendor_names(self, seated, monkeypatch):
        live = seated()
        AttendanceApi.record_attendance(MARKET, ANA, SAT, checked_in_by=EDITOR)

        def refused(*_a, **_k):
            raise AssertionError("the check-in count read the vendors' names")
        monkeypatch.setattr(ApplicationsApi, "vendor_names_for_market", refused)

        assert AttendanceApi.check_in_counts(live.doc)["came"] == 1
