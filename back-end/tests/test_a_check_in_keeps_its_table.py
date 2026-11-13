"""A check-in records the table it was made at, and the roster says where each vendor stands (T318).

A check-in said only that a vendor came on a date, not where. So a vendor checked in and then freed
vanished from the roster while their record stayed, and when seated again elsewhere they read as
"checked in" at a table they never reached, with the old time (T277 report section 4.9). Now the
record keeps its table, and the roster serves each row a state: ``expected``, ``here``,
``here_elsewhere`` (here, at another table than the one they now hold) or ``here_without_seat``
(here, with no table on that day).

A check-in or its undo also holds the market's phase: it reads the phase, writes, and reads it
again, and takes its write back if the market left its days in between, so neither lands on a
market archived a moment before (ADR 0024's race across two collections). And the organizer's door
refuses a date that has not begun anywhere on Earth, while still taking a past day.

Each is sent through the Flask client, as the screen sends it.
"""
from datetime import datetime, timedelta, timezone

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import api.attendance as AttendanceApi  # noqa: E402
import api.placements as PlacementsApi  # noqa: E402
import history as History  # noqa: E402
from datatypes import MarketPhase  # noqa: E402
from test_every_write_records import (  # noqa: E402,F401
    DATE, MARKET, OWNER, VENDOR, _seated, client, world,
)
from test_the_placement_endpoint import SETUP_OBJECT, placement  # noqa: E402

ATTENDANCE = f"/markets/{MARKET}/attendance"
PLACEMENTS = f"/markets/{MARKET}/placements"
ARCHIVED = "This market has ended, so check-in is closed."
NOT_BEGUN = "That day has not begun yet, so nobody can be checked in for it."
BEN = "ben@example.com"


def on_its_days(world, *emails, setup=SETUP_OBJECT):
    """The market in its days, with ``emails`` seated at Hall A 1, Hall A 2, ... on ``DATE``."""
    world.market(MarketPhase.MARKET_DAYS, setupObject=setup, assignmentObject=_seated(*emails))
    world.patch(PlacementsApi, "has_applied", lambda _market_id, _address: True)


def check_in(client, email=VENDOR, date=DATE):
    return client.post(ATTENDANCE, json={"vendorEmail": email, "date": date})


def undo(client, email=VENDOR, date=DATE):
    return client.delete(ATTENDANCE, json={"vendorEmail": email, "date": date})


def rows_of(client, email=VENDOR, date=DATE):
    answer = client.get(ATTENDANCE)
    assert answer.status_code == 200, answer.get_json()
    return [row for row in answer.get_json()["roster"]
            if row["vendorEmail"] == email and row["date"] == date]


def row_of(client, email=VENDOR, date=DATE):
    [row] = rows_of(client, email, date)
    return row


class TestTheCheckInKeepsItsTable:
    def test_a_vendor_freed_and_seated_elsewhere_never_reads_as_here_at_the_new_table(
            self, client, world):
        on_its_days(world, VENDOR)
        assert check_in(client).status_code == 200
        arrived = row_of(client)["checkedInAt"]

        freed = client.delete(PLACEMENTS, json={"email": VENDOR, "date": DATE})
        assert freed.status_code == 200, freed.get_json()
        # Still listed: their arrival is not hidden once they hold no table.
        row = row_of(client)
        assert (row["state"], row["tableCode"], row["checkedInTableCode"]) == (
            "here_without_seat", None, "Hall A 1")
        assert row["checkedInAt"] == arrived

        placed = client.put(PLACEMENTS, json=placement(email=VENDOR, table_code="Hall A 2"))
        assert placed.status_code == 200, placed.get_json()
        row = row_of(client)
        # Checked in at the table they reached, not the one they hold now.
        assert (row["state"], row["tableCode"], row["checkedInTableCode"]) == (
            "here_elsewhere", "Hall A 2", "Hall A 1")

    def test_the_record_stores_the_table_it_was_made_at(self, client, world):
        on_its_days(world, VENDOR)

        check_in(client)

        [record] = world.attendance.documents
        assert record["table_code"] == "Hall A 1"

    def test_checking_in_again_at_a_new_seat_moves_the_record_to_it(self, client, world):
        on_its_days(world, VENDOR)
        check_in(client)
        client.put(PLACEMENTS, json=placement(email=VENDOR, table_code="Hall A 2"))

        assert check_in(client).status_code == 200

        [record] = world.attendance.documents
        assert record["table_code"] == "Hall A 2"
        row = row_of(client)
        assert (row["state"], row["checkedInTableCode"]) == ("here", "Hall A 2")


class TestTheRosterSaysWhereEachVendorStands:
    def test_expected(self, client, world):
        on_its_days(world, VENDOR)

        row = row_of(client)

        assert (row["state"], row["checkedInAt"], row["checkedInTableCode"]) == (
            "expected", None, None)

    def test_here(self, client, world):
        on_its_days(world, VENDOR)
        check_in(client)

        row = row_of(client)

        assert (row["state"], row["tableCode"], row["checkedInTableCode"]) == (
            "here", "Hall A 1", "Hall A 1")

    def test_a_record_made_before_tables_were_kept_reads_as_here_at_the_seat_held_now(
            self, client, world):
        on_its_days(world, VENDOR)
        world.attendance.insert_one({
            "market_id": MARKET, "vendor_email": VENDOR, "date": DATE,
            "checked_in_at": "2026-08-01T09:00:00+00:00", "checked_in_by": OWNER,
            "checked_in_via": None,
        })

        row = row_of(client)

        assert (row["state"], row["checkedInTableCode"]) == ("here", "Hall A 1")

    def test_here_elsewhere(self, client, world):
        on_its_days(world, VENDOR)
        world.attendance.insert_one({
            "market_id": MARKET, "vendor_email": VENDOR, "date": DATE, "table_code": "Hall A 7",
            "checked_in_at": "2026-08-01T09:00:00+00:00", "checked_in_by": OWNER,
            "checked_in_via": None,
        })

        row = row_of(client)

        assert (row["state"], row["tableCode"], row["checkedInTableCode"]) == (
            "here_elsewhere", "Hall A 1", "Hall A 7")

    def test_here_without_seat_is_a_row_of_its_own_after_the_days_seats(self, client, world):
        on_its_days(world, BEN)
        world.attendance.insert_one({
            "market_id": MARKET, "vendor_email": VENDOR, "date": DATE, "table_code": "Hall A 7",
            "checked_in_at": "2026-08-01T09:00:00+00:00", "checked_in_by": None,
            "checked_in_via": AttendanceApi.VIA_DOOR_CODE,
        })

        roster = client.get(ATTENDANCE).get_json()["roster"]

        assert [(r["vendorEmail"], r["state"]) for r in roster] == [
            (BEN, "expected"), (VENDOR, "here_without_seat")]
        row = roster[1]
        assert (row["tableCode"], row["checkedInTableCode"], row["checkedInVia"]) == (
            None, "Hall A 7", AttendanceApi.VIA_DOOR_CODE)

    def test_the_stats_count_seated_rows_only(self, client, world):
        on_its_days(world, BEN)
        world.attendance.insert_one({
            "market_id": MARKET, "vendor_email": VENDOR, "date": DATE, "table_code": "Hall A 7",
            "checked_in_at": "2026-08-01T09:00:00+00:00",
        })

        counts = AttendanceApi.check_in_counts(world.markets.doc)

        assert [d for d in counts["dates"] if d["date"] == DATE] == [
            {"date": DATE, "expected": 1, "checkedIn": 0}]


#: Every way the door writes a check-in or takes one away.
DOOR_WRITES = ("update_one", "find_one_and_update", "delete_one", "find_one_and_delete")


def archive_at_the_write(world):
    """The market is archived the moment the door writes: after its read of the phase, before its
    write lands."""
    for name in DOOR_WRITES:
        if hasattr(world.attendance, name):
            world.patch(world.attendance, name, _archiving_first(world, getattr(world.attendance, name)))


def _archiving_first(world, write):
    def archived_first(*args, **kwargs):
        world.markets.doc["phase"] = MarketPhase.ARCHIVED.value
        return write(*args, **kwargs)
    return archived_first


class TestTheDoorHoldsThePhase:
    def test_a_check_in_on_a_market_archived_a_moment_before_leaves_no_record(self, client, world):
        on_its_days(world, VENDOR)
        archive_at_the_write(world)

        answer = check_in(client)

        assert answer.status_code == 409, answer.get_json()
        assert answer.get_json()["error"] == ARCHIVED
        assert world.attendance.documents == []
        assert world.history.documents == []

    def test_a_check_in_again_on_a_market_archived_a_moment_before_puts_the_record_back(
            self, client, world):
        on_its_days(world, VENDOR)
        before = {
            "market_id": MARKET, "vendor_email": VENDOR, "date": DATE,
            "checked_in_at": "2026-08-01T09:00:00+00:00", "checked_in_by": None,
            "checked_in_via": AttendanceApi.VIA_DOOR_CODE,
        }
        world.attendance.insert_one(dict(before))
        archive_at_the_write(world)

        answer = check_in(client)

        assert answer.status_code == 409, answer.get_json()
        [record] = world.attendance.documents
        assert {key: value for key, value in record.items() if key != "_id"} == before
        assert world.history.documents == []

    def test_an_undo_on_a_market_archived_a_moment_before_leaves_the_record(self, client, world):
        on_its_days(world, VENDOR)
        check_in(client)
        [record] = world.attendance.documents
        kept = dict(record)
        world.history.documents.clear()
        archive_at_the_write(world)

        answer = undo(client)

        assert answer.status_code == 409, answer.get_json()
        assert answer.get_json()["error"] == ARCHIVED
        assert world.attendance.documents == [kept]
        assert world.history.documents == []

    def test_a_check_in_on_a_market_that_left_its_days_before_its_read_is_refused(
            self, client, world):
        on_its_days(world, VENDOR)
        world.markets.doc["phase"] = MarketPhase.ASSIGNMENT.value

        result, status = AttendanceApi.record_attendance(MARKET, VENDOR, DATE)

        assert status == 409
        assert result["error"] == "Vendors are checked in once the market is published."
        assert world.attendance.documents == []

    def test_an_undo_on_an_archived_market_is_refused_on_its_own_read(self, client, world):
        on_its_days(world, VENDOR)
        check_in(client)
        world.markets.doc["phase"] = MarketPhase.ARCHIVED.value

        result, status = AttendanceApi.undo_attendance(MARKET, VENDOR, DATE)

        assert status == 409
        assert result["error"] == ARCHIVED
        assert len(world.attendance.documents) == 1


def utc_date(days_from_now: int) -> str:
    return (datetime.now(timezone.utc).date() + timedelta(days=days_from_now)).isoformat()


def a_market_on(world, day):
    setup = {**SETUP_OBJECT, "marketDates": [{"date": DATE}, {"date": day}]}
    world.market(MarketPhase.MARKET_DAYS, setupObject=setup, assignmentObject={
        "vendorAssignments": [
            {**_seated(VENDOR)["vendorAssignments"][0], "date": day},
        ],
        "assignmentStatistics": None,
    })


class TestTheOrganizersDoorKeepsToDaysThatHaveBegun:
    def test_a_day_that_has_not_begun_anywhere_is_refused(self, client, world):
        day = utc_date(2)
        a_market_on(world, day)

        answer = check_in(client, date=day)

        assert answer.status_code == 409, answer.get_json()
        assert answer.get_json()["error"] == NOT_BEGUN
        assert world.attendance.documents == []

    def test_tomorrow_in_utc_has_begun_somewhere(self, client, world):
        day = utc_date(1)
        a_market_on(world, day)

        assert check_in(client, date=day).status_code == 200

    def test_a_past_market_day_still_takes_a_check_in(self, client, world):
        on_its_days(world, VENDOR)

        answer = check_in(client)

        assert answer.status_code == 200, answer.get_json()
        assert DATE < utc_date(-30)
