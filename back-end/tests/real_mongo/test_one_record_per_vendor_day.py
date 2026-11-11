"""One owed record and one check-in per vendor's day, on a real server with real threads (T270).

Both are upserts by market, vendor and date, so two that land at once on a day with no record both
match nothing and both insert; only the boot's unique index on (market, vendor, date) keeps the day
one record. The hermetic suite proves each writer's retry through fakes; these run the race where
the index lives.

What the server does is part of the answer. MongoDB retries an upsert refused by a unique index
itself when its filter is equalities on exactly the index's fields, so a check-in or an amount set
by hand, whose filter is the vendor's day, never sees the refusal: none reached the client in 600
such upserts on 8.0. A free's write also holds the amount by hand it read, a field beyond the
index, so its refusal comes back, and ``payments.keep_freed_line``'s retry is what lands it; the
staged test below makes every free meet it.
"""
import threading
from typing import Any, Dict, List

import pytest
from pymongo.errors import DuplicateKeyError

import api.attendance as AttendanceApi
import history as History
import payments as Payments
from real_mongo import harness

MARKET = "market-vendor-day"
VENDOR = "racing-vendor@example.com"
DAY = "2099-05-08"
ADMIN = "admin@example.com"
EDITOR = "editor@example.com"
SEAT = Payments.Seat(table_code="Main Hall 1", tier="Full Table", table_choice="Full Table",
                     cents=3500)

#: How long a staged thread waits for the others, so a missed release fails instead of hanging.
STAGE_TIMEOUT_SECONDS = harness.RACE_TIMEOUT_SECONDS


def _owed_records(amounts_owed) -> List[Dict[str, Any]]:
    return list(amounts_owed.find({"market_id": MARKET, "vendor_email": VENDOR, "date": DAY}))


def _set(i: int) -> None:
    """The ``i``th Admin's amount by hand, ``100 + i`` cents, on the day."""
    return Payments.set_amount_owed(MARKET, VENDOR, DAY, 100 + i, f"{ADMIN}#{i}")


def _free(i: int, deduct: bool):
    return Payments.keep_freed_line(MARKET, VENDOR, DAY, SEAT, f"{EDITOR}#{i}", deduct=deduct)


class _Counting:
    """The owed collection, counting each unique-index refusal its writes met, by thread."""

    def __init__(self, collection):
        self._collection = collection
        self.refused: Dict[int, int] = {}
        self._lock = threading.Lock()

    def __getattr__(self, name):
        return getattr(self._collection, name)

    def find_one_and_update(self, *args, **kwargs):
        try:
            return self._collection.find_one_and_update(*args, **kwargs)
        except DuplicateKeyError:
            with self._lock:
                key = threading.get_ident()
                self.refused[key] = self.refused.get(key, 0) + 1
            raise


class TestOneOwedRecordPerVendorDay:
    @pytest.mark.parametrize("deduct", [False, True], ids=["free", "free and deduct"])
    def test_twenty_amounts_set_and_twenty_frees_at_once_on_a_new_day_leave_one_record(
            self, boot_indexes, market_records, race, deduct):
        """Every thread writes the day's first record: none was there when they were released."""
        amounts_owed = market_records.amounts_owed
        harness.warm(amounts_owed, 40)

        answered = race(40, lambda i: _set(i) if i < 20 else _free(i, deduct))

        setters, frees = answered[:20], answered[20:]
        # Setting an amount always lands; a free lands, or after three reads of an amount by hand
        # that kept changing under it writes nothing and says so, a 409 at the route.
        assert setters == [None] * 20
        assert [f for f in frees if not (isinstance(f, tuple)
                                         or isinstance(f, Payments.OwedChangedUnderFree))] == []
        [record] = _owed_records(amounts_owed)
        landed = [written for _before, written in (f for f in frees if isinstance(f, tuple))]
        if landed:
            assert record["freed"] in [written["freed"] for written in landed]
        else:
            assert record.get("freed") is None
        amounts_set = [{"cents": 100 + i, "by": f"{ADMIN}#{i}"} for i in range(20)]
        by_hand = record["set_by_hand"]
        if by_hand.get("by_free"):
            # A free's $0 keeps the Admin's amount it replaced, so seating the day again puts it back.
            assert deduct
            assert {"cents": by_hand["cents"], "by": by_hand["by"]} in [
                {"cents": 0, "by": f"{EDITOR}#{i}"} for i in range(20, 40)]
            # Never None: a free lands only on the amount it read, and every Admin's write lands, so a
            # $0 standing last was written over an Admin's amount, or over a $0 that kept one.
            replaced = by_hand["replaced"]
            assert {key: replaced[key] for key in ("cents", "by")} in amounts_set
        else:
            # Without a deduction a free writes no amount; one an Admin set is never lost to it.
            assert {key: by_hand[key] for key in ("cents", "by")} in amounts_set

    @pytest.mark.parametrize("deduct", [False, True], ids=["free", "free and deduct"])
    def test_frees_that_read_no_record_meet_the_index_and_land_on_the_admins_record(
            self, boot_indexes, market_records, race, monkeypatch, deduct):
        """Staged so the losing branch runs every time: the twenty frees each read the day with no
        record, the twenty amounts set by hand then create it, and only then do the frees write.
        Each free's upsert is refused by the unique index, and its retry lands on that record."""
        amounts_owed = market_records.amounts_owed
        counting = _Counting(amounts_owed)
        monkeypatch.setattr(Payments, "amounts_owed_collection", counting)
        harness.warm(amounts_owed, 40)

        all_read = threading.Event()
        all_set = threading.Event()
        read_together = threading.Barrier(20, action=all_read.set, timeout=STAGE_TIMEOUT_SECONDS)
        staged = threading.local()
        set_count = []
        set_lock = threading.Lock()
        after_setters: Dict[str, Any] = {}

        def find_one(*args, **kwargs):
            found = amounts_owed.find_one(*args, **kwargs)
            if not getattr(staged, "read", False):
                staged.read = True
                read_together.wait()
                if not all_set.wait(STAGE_TIMEOUT_SECONDS):
                    raise AssertionError("the amounts set never all landed")
            return found

        counting.find_one = find_one

        def setter(i):
            if not all_read.wait(STAGE_TIMEOUT_SECONDS):
                raise AssertionError("the frees never all read the day")
            _set(i)
            with set_lock:
                set_count.append(i)
                if len(set_count) == 20:
                    [after_setters["record"]] = _owed_records(amounts_owed)
                    all_set.set()

        frees_ident = set()

        def freer(i):
            frees_ident.add(threading.get_ident())
            return _free(i, deduct)

        answered = race(40, lambda i: setter(i) if i < 20 else freer(i))

        setters, frees = answered[:20], answered[20:]
        assert setters == [None] * 20
        # Every free's first write met the index once, and no free met it twice.
        assert {ident: counting.refused.get(ident, 0) for ident in frees_ident} == {
            ident: 1 for ident in frees_ident}
        [record] = _owed_records(amounts_owed)
        admins = after_setters["record"]["set_by_hand"]
        landed = [f for f in frees if isinstance(f, tuple)]
        if deduct:
            # The frees then race each other's $0: each lands, or gives up having written nothing.
            assert [f for f in frees if not (isinstance(f, tuple)
                                             or isinstance(f, Payments.OwedChangedUnderFree))] == []
            assert landed
            # Whichever free's $0 stands, it keeps the amount the Admins left as its ``replaced``.
            assert record["set_by_hand"]["by_free"] is True
            assert record["set_by_hand"]["cents"] == 0
            assert record["set_by_hand"]["replaced"] == admins
        else:
            # A free that writes no amount always lands, and leaves the Admins' amount standing.
            assert len(landed) == 20
            assert record["set_by_hand"] == admins
            assert all(written == {"freed": written["freed"]} for _before, written in landed)
        assert record["freed"] in [written["freed"] for _before, written in landed]


class TestOneCheckInPerVendorDay:
    def test_twenty_check_ins_at_once_leave_one_record_and_one_arrival(
            self, boot_indexes, real_db, market_records, race):
        real_db["markets"].insert_one({
            "id": MARKET,
            "assignmentObject": {"vendorAssignments": [{"email": VENDOR, "date": DAY,
                                                        "tableCode": "Main Hall 1"}]},
        })
        harness.warm(market_records.attendance, 20)

        answered = race(20, lambda i: AttendanceApi.record_attendance(
            MARKET, VENDOR, DAY, checked_in_by=f"{EDITOR}#{i}"))

        assert [status for _body, status in answered] == [200] * 20
        assert {body["message"] for body, _status in answered} == {"Checked in"}
        [record] = list(market_records.attendance.find(
            {"market_id": MARKET, "vendor_email": VENDOR, "date": DAY}))
        # The record is the last check-in's: each one writes its own time and organizer.
        assert record["checked_in_at"] in {body["checkedInAt"] for body, _status in answered}
        arrivals = list(market_records.history.find({"market_id": MARKET,
                                                     "kind": History.CHECKED_IN}))
        assert len(arrivals) == 1
