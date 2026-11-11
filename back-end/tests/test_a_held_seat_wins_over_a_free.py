"""A held seat owes its price, and a free leaves the right amount whatever stops it (T270).

A free answered "Also remove its $35.00 from what they owe?" sets the day's $0, marked as the
free's; seating the day again takes it back. When the request that seats it again stopped before
the freed line was forgotten, the $0 stayed on a day the vendor holds a table for, and it read as
deliberate. A free whose deduction came after the seat was freed lost it to a stop in between,
and a retry did nothing; a free whose seat write failed left a freed record that came back as a
line once a run dropped the vendor.

So: a day held reads its seat whatever a free left on it; a free writes its line and its $0 in
one write before the seat goes, and takes both back if the seat cannot go; every write of the
assignment forgets the freed records of the days it touched; and the history says "owed taken
back" only for a day that read as freed.
"""
import pytest
from pymongo.errors import AutoReconnect, DuplicateKeyError

import api.payments as PaymentsApi
from client_errors import ConflictError
import api.placements as PlacementsApi
import history as History
import payments as Payments
from datatypes import MarketPhase, VendorAssignmentResult
from test_a_vendors_payments import ANA, EDITOR, MARKET, SAT, SUN, market, stores  # noqa: F401
from test_changing_owed_and_paid import ADMIN, admin, entries, holding, line  # noqa: F401

BEN = "ben@example.com"


class Stopped(Exception):
    """The host ending the request, or a step failing, at the point a test names."""


def stop(*_args, **_kwargs):
    raise Stopped()


def stop_once(monkeypatch, owner, name):
    """``owner.name`` raises the next time it is called, then is itself again."""
    original = getattr(owner, name)

    def stopped(*_args, **_kwargs):
        monkeypatch.setattr(owner, name, original)
        raise Stopped()

    monkeypatch.setattr(owner, name, stopped)


def seat(date, table_code="Landing 1", email=ANA):
    return {"email": email, "date": date, "table_code": table_code, "table_choice": "Full Table"}


def taken_back(stores):  # noqa: F811
    return [entry for entry in stores.history.documents
            if entry["kind"] == History.OWED_TAKEN_BACK]


def a_run_that_seats(monkeypatch, market, *seats):  # noqa: F811
    """The run stores exactly ``seats``, as a solver that dropped everyone else would."""
    market.doc["phase"] = MarketPhase.ASSIGNMENT.value

    def ran(assigned, _vendors):
        assigned.assignment_object.vendor_assignments = list(seats)
        return assigned

    monkeypatch.setattr(PlacementsApi, "solver_vendors_for", lambda _market: ["ana"])
    monkeypatch.setattr(PlacementsApi, "assign_market", ran)
    monkeypatch.setattr(PlacementsApi.MadeFrom, "fingerprint", lambda *_a: {})


def a_stale_freed_record(date, deducted=True):
    """What a free that stopped before its seat write left on a day the vendor still holds."""
    held = PaymentsApi.seats_by_vendor(
        PlacementsApi.MarketsApi.market_from_document(
            PlacementsApi.MarketsApi.markets_collection.doc))[ANA][date]
    Payments.keep_freed_line(MARKET, ANA, date, held, EDITOR, deduct=deducted)


SATURDAY_ELSEWHERE = VendorAssignmentResult(
    email=ANA, date=SAT, table_code="Landing 2", table_choice="Full Table",
    section="Landing", tier="Silver", location="Main Hall")


class TestAHeldSeatOwesItsPrice:
    def test_a_re_seat_after_a_deducted_free_owes_the_new_seat_even_when_it_stopped(
            self, admin, monkeypatch):
        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True)
        monkeypatch.setattr(PaymentsApi, "seated_again", stop)

        with pytest.raises(Stopped):
            PlacementsApi.write_placement(MARKET, seat(SUN), ADMIN)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["priceCents"]) == (False, 3000, 3000)
        assert (sunday["owedByFree"], sunday["owedSetBy"], sunday["owedSetAt"]) == (
            False, None, None)

    def test_an_amount_an_admin_set_still_holds_on_a_held_seat(self, admin):
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 1000}, ADMIN)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedSetBy"]) == (False, 1000, ADMIN)
        assert sunday["owedByFree"] is False

    def test_an_amount_an_admin_set_outlives_a_free_that_stopped_before_its_seat(
            self, admin, stores):  # noqa: F811
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 5000}, ADMIN)
        set_at = line(SUN)["owedSetAt"]
        a_stale_freed_record(SUN)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedByFree"]) == (False, 5000, False)
        assert (sunday["owedSetBy"], sunday["owedSetAt"]) == (ADMIN, set_at)

        PlacementsApi.write_placement(MARKET, seat(SUN), ADMIN)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedByFree"]) == (False, 5000, False)
        assert (sunday["owedSetBy"], sunday["owedSetAt"]) == (ADMIN, set_at)
        [record] = [doc for doc in stores.owed.documents if doc["date"] == SUN]
        assert record["freed"] is None
        assert taken_back(stores) == []

    def test_a_re_seat_after_a_deducted_free_puts_back_the_admins_amount(
            self, admin, stores):  # noqa: F811
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 5000}, ADMIN)
        set_at = line(SUN)["owedSetAt"]
        PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR, deduct_owed=True)
        assert line(SUN)["owedCents"] == 0

        PlacementsApi.write_placement(MARKET, seat(SUN), ADMIN)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedByFree"]) == (False, 5000, False)
        assert (sunday["owedSetBy"], sunday["owedSetAt"]) == (ADMIN, set_at)
        [entry] = taken_back(stores)
        assert entry["detail"] == {"before": {"owed_cents": 0}, "after": {"owed_cents": 5000}}

    def test_a_re_seat_stopped_before_it_forgot_the_free_keeps_the_admins_amount(
            self, admin, stores, monkeypatch):  # noqa: F811
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 5000}, ADMIN)
        PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR, deduct_owed=True)
        stop_once(monkeypatch, PaymentsApi, "seated_again")

        with pytest.raises(Stopped):
            PlacementsApi.write_placement(MARKET, seat(SUN), ADMIN)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedSetBy"]) == (False, 5000, ADMIN)

        PlacementsApi.write_placement(MARKET, seat(SUN), ADMIN)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedSetBy"]) == (False, 5000, ADMIN)
        assert sunday["owedByFree"] is False
        [record] = [doc for doc in stores.owed.documents if doc["date"] == SUN]
        assert record["freed"] is None

    def test_a_move_of_the_seat_with_no_free_keeps_the_admins_amount(self, admin):
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 5000}, ADMIN)

        PlacementsApi.write_placement(MARKET, seat(SUN, "Landing 2"), ADMIN)

        sunday = line(SUN)
        assert (sunday["tableCode"], sunday["owedCents"], sunday["owedSetBy"]) == (
            "Landing 2", 5000, ADMIN)

    def test_a_freed_day_still_reads_the_frees_zero(self, admin):
        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedByFree"]) == (True, 0, True)
        assert sunday["owedSetBy"] == ADMIN


class TestAFreeLeavesTheRightAmount:
    def test_a_deducted_free_owes_nothing_whatever_stops_it_after_the_seat(
            self, admin, stores, monkeypatch):  # noqa: F811
        stop_once(monkeypatch, History, "record_freed")

        with pytest.raises(Stopped):
            PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedByFree"]) == (True, 0, True)

        assert PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True) == (
            {"removed": 0}, 200)
        assert line(SUN)["owedCents"] == 0
        # The free that landed already set its $0, so the retry has nothing to deduct.
        assert entries(stores, "change-owed") == []

    def test_the_deduction_is_recorded_from_what_the_held_seat_owed(self, admin, stores):  # noqa: F811
        a_stale_freed_record(SUN)

        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True)

        [deducted] = entries(stores, "change-owed")
        assert (deducted["kind"], deducted["actor"], deducted["subject"]) == (
            History.OWED_SET, ADMIN, {"date": SUN, "currency": "CAD"})
        assert deducted["detail"] == {"before": {"owed_cents": 3500}, "after": {"owed_cents": 0}}

    def test_a_free_again_on_a_day_an_older_free_left_owing_deducts_it(self, admin, stores):  # noqa: F811
        """A free from before this change set its $0 after the seat, so a stop between left the
        day freed and owing its full amount; pressing Free again is the retry a person makes."""
        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN)
        assert line(SUN)["owedCents"] == 3500

        assert PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True) == (
            {"removed": 0}, 200)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedByFree"]) == (True, 0, True)
        [deducted] = entries(stores, "change-owed")
        assert deducted["kind"] == History.OWED_SET
        assert deducted["detail"] == {"before": {"owed_cents": 3500}, "after": {"owed_cents": 0}}

    def test_a_free_again_leaves_an_amount_an_admin_set_on_the_freed_day(self, admin, stores):  # noqa: F811
        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN)
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 1000}, ADMIN)

        assert PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True) == (
            {"removed": 0}, 200)

        sunday = line(SUN)
        assert (sunday["owedCents"], sunday["owedByFree"]) == (1000, False)
        assert [entry["detail"]["after"] for entry in entries(stores, "change-owed")] == [
            {"owed_cents": 1000}]

    def test_a_free_again_of_a_day_with_no_line_writes_nothing(self, admin, stores):  # noqa: F811
        assert PlacementsApi.remove_placement(MARKET, BEN, SUN, ADMIN, deduct_owed=True) == (
            {"removed": 0}, 200)

        assert stores.owed.documents == []
        assert entries(stores, "change-owed") == []

    def test_a_free_unticked_on_a_freed_day_deducts_nothing(self, admin, stores):  # noqa: F811
        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN)

        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN)

        assert line(SUN)["owedCents"] == 3500
        assert entries(stores, "change-owed") == []

    def test_a_free_unticked_over_a_stopped_frees_zero_keeps_the_admins_amount(
            self, admin, stores):  # noqa: F811
        """A deducted free that stopped before its seat went left its $0 holding the Admin's
        amount as ``replaced``; a free that then asks nothing must not leave that $0 standing."""
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 5000}, ADMIN)
        set_at = line(SUN)["owedSetAt"]
        a_stale_freed_record(SUN)
        recorded = entries(stores, "change-owed")

        PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedByFree"]) == (True, 5000, False)
        assert (sunday["owedSetBy"], sunday["owedSetAt"]) == (ADMIN, set_at)
        assert entries(stores, "change-owed") == recorded

    def test_a_free_unticked_over_a_stopped_frees_zero_owes_the_seats_price(
            self, admin, stores):  # noqa: F811
        a_stale_freed_record(SUN)

        PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedByFree"]) == (True, 3500, False)
        assert sunday["owedSetBy"] is None
        [record] = [doc for doc in stores.owed.documents if doc["date"] == SUN]
        assert record["set_by_hand"] is None
        assert entries(stores, "change-owed") == []

    @pytest.mark.parametrize("deduct_owed", [False, True])
    def test_a_free_whose_seat_write_fails_leaves_nothing_a_run_could_surface(
            self, admin, stores, market, monkeypatch, deduct_owed):  # noqa: F811
        stop_once(monkeypatch, PlacementsApi, "_store_vendor_assignments")

        with pytest.raises(Stopped):
            PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=deduct_owed)

        assert line(SUN)["freed"] is False
        a_run_that_seats(monkeypatch, market, SATURDAY_ELSEWHERE)

        _result, status = PlacementsApi.run_assignment(MARKET, ADMIN)

        assert status == 200
        assert [line["date"] for line in PaymentsApi.vendor_account(MARKET, ANA, ADMIN)["lines"]] == [
            SAT]
        assert all(doc.get("freed") is None and doc.get("set_by_hand") is None
                   for doc in stores.owed.documents)

    def test_a_failed_seat_write_leaves_an_amount_an_admin_set_as_it_was(
            self, admin, stores, monkeypatch):  # noqa: F811
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 1000}, ADMIN)
        stop_once(monkeypatch, PlacementsApi, "_store_vendor_assignments")

        with pytest.raises(Stopped):
            PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedSetBy"]) == (False, 1000, ADMIN)
        assert sunday["owedByFree"] is False

    @pytest.mark.parametrize("deduct_owed, owed", [(False, 3500), (True, 0)])
    def test_a_seat_write_that_landed_and_then_raised_keeps_the_days_line(
            self, admin, monkeypatch, deduct_owed, owed):  # noqa: F811
        """A store can reach the database and the answer be lost on the way back: the seat is
        free then, so the line kept for it is the day's, and putting it back would leave the day
        owing nothing for a table the vendor gave back, with no freed line to retry from."""
        stored = PlacementsApi._store_vendor_assignments

        def landed_then_lost(*args, **kwargs):
            stored(*args, **kwargs)
            raise AutoReconnect("the answer never came back")

        monkeypatch.setattr(PlacementsApi, "_store_vendor_assignments", landed_then_lost)

        with pytest.raises(AutoReconnect):
            PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=deduct_owed)

        sunday = line(SUN)
        assert (sunday["freed"], sunday["owedCents"], sunday["owedByFree"]) == (
            True, owed, deduct_owed)

    def test_a_seat_write_that_failed_when_the_seat_cannot_be_read_again_keeps_the_line(
            self, admin, stores, monkeypatch):  # noqa: F811
        """Not knowing whether the seat went, the line stays: while the seat is held it reads
        the seat's price, and the next write of the day forgets it."""
        markets = PlacementsApi.MarketsApi.markets_collection

        def lost_with_the_database(*_args, **_kwargs):
            monkeypatch.setattr(markets, "find_one", stop)
            raise Stopped()

        monkeypatch.setattr(PlacementsApi, "_store_vendor_assignments", lost_with_the_database)

        with pytest.raises(Stopped):
            PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True)

        [kept] = [doc for doc in stores.owed.documents if doc["date"] == SUN]
        assert kept["freed"] is not None


class TestAnAmountSetAsTheFreeWrites:
    """An Admin's amount set between the free's read of the day and its write is the one the
    free's $0 keeps as ``replaced``, so seating the day again puts it back, not an older one."""

    @staticmethod
    def an_admin_sets_it_after_the_read(monkeypatch, owed, cents):
        """The next read of the day's record answers as it was, then an Admin sets ``cents``."""
        read = owed.find_one

        def read_then_set(query, *args, **kwargs):
            monkeypatch.setattr(owed, "find_one", read)
            found = read(query, *args, **kwargs)
            PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": cents}, ADMIN)
            return found

        monkeypatch.setattr(owed, "find_one", read_then_set, raising=False)

    @staticmethod
    def the_index_refuses_a_second_record(monkeypatch, owed):
        """An upsert that matches nothing on a day that has a record inserts a second one, which
        the unique index refuses, as MongoDB does; the fake holds no index."""
        write = owed.find_one_and_update

        def refused(query, update, upsert=False, **kwargs):
            day = {key: query[key] for key in ("market_id", "vendor_email", "date")}
            if upsert and owed._first(query) is None and owed._first(day) is not None:
                raise DuplicateKeyError("E11000 duplicate key error", code=11000)
            return write(query, update, upsert=upsert, **kwargs)

        monkeypatch.setattr(owed, "find_one_and_update", refused, raising=False)

    def test_an_amount_changed_after_the_frees_read_is_the_one_kept(
            self, admin, stores, monkeypatch):  # noqa: F811
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 4000}, ADMIN)
        self.an_admin_sets_it_after_the_read(monkeypatch, stores.owed, 5000)

        PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR, deduct_owed=True)

        [record] = [doc for doc in stores.owed.documents if doc["date"] == SUN]
        assert record["set_by_hand"]["replaced"]["cents"] == 5000
        PlacementsApi.write_placement(MARKET, seat(SUN), ADMIN)
        assert (line(SUN)["owedCents"], line(SUN)["owedSetBy"]) == (5000, ADMIN)

    def test_an_amount_first_set_after_the_frees_read_is_kept(
            self, admin, stores, monkeypatch):  # noqa: F811
        self.the_index_refuses_a_second_record(monkeypatch, stores.owed)
        self.an_admin_sets_it_after_the_read(monkeypatch, stores.owed, 5000)

        PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR, deduct_owed=True)

        [record] = [doc for doc in stores.owed.documents if doc["date"] == SUN]
        assert record["set_by_hand"]["replaced"]["cents"] == 5000
        assert line(SUN)["owedCents"] == 0
        PlacementsApi.write_placement(MARKET, seat(SUN), ADMIN)
        assert (line(SUN)["owedCents"], line(SUN)["owedSetBy"]) == (5000, ADMIN)

    @pytest.mark.parametrize("deduct_owed", [False, True])
    def test_an_amount_that_keeps_changing_frees_nothing_and_says_so(
            self, admin, stores, monkeypatch, deduct_owed):  # noqa: F811
        PaymentsApi.set_amount_owed(MARKET, ANA, SUN, {"cents": 4000}, ADMIN)
        recorded = entries(stores, "change-owed")
        read = stores.owed.find_one
        amounts = iter(range(4100, 9999, 100))

        def read_then_set(query, *args, **kwargs):
            found = read(query, *args, **kwargs)
            Payments.set_amount_owed(MARKET, ANA, SUN, next(amounts), ADMIN)
            return found

        monkeypatch.setattr(stores.owed, "find_one", read_then_set, raising=False)

        with pytest.raises(ConflictError) as refused:
            PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR, deduct_owed=deduct_owed)

        assert refused.value.message == PaymentsApi.OWED_CHANGED_UNDER_FREE
        monkeypatch.setattr(stores.owed, "find_one", read)
        # Nothing freed: the stored day holds neither a freed record nor a $0, only the last
        # amount the Admin set, the seat is still Ana's, and nothing was recorded but the sets.
        [record] = [doc for doc in stores.owed.documents if doc["date"] == SUN]
        assert record.get("freed") is None
        assert record["set_by_hand"]["cents"] == 4100 + 100 * (Payments._FREE_TRIES - 1)
        assert not record["set_by_hand"].get("by_free")
        held = PaymentsApi.seats_by_vendor(
            PlacementsApi.MarketsApi.market_from_document(
                PlacementsApi.MarketsApi.markets_collection.doc))[ANA]
        assert SUN in held
        assert [entry for entry in stores.history.documents if entry["kind"] in (
            History.FREED, History.OWED_TAKEN_BACK)] == []
        assert entries(stores, "change-owed") == recorded


class TestEveryWriteForgetsTheStaleFreedRecordsOfItsDays:
    def test_a_run_that_drops_a_day_clears_its_stale_record_with_no_entry(
            self, admin, stores, market, monkeypatch):  # noqa: F811
        a_stale_freed_record(SUN)
        a_run_that_seats(monkeypatch, market, SATURDAY_ELSEWHERE)

        _result, status = PlacementsApi.run_assignment(MARKET, ADMIN)

        assert status == 200
        [record] = stores.owed.documents
        assert (record["freed"], record["set_by_hand"]) == (None, None)
        assert [line["date"] for line in PaymentsApi.vendor_account(MARKET, ANA, ADMIN)["lines"]] == [
            SAT]
        assert taken_back(stores) == []

    def test_a_run_that_seats_a_freed_day_again_records_the_taking_back(
            self, admin, stores, market, monkeypatch):  # noqa: F811
        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True)
        a_run_that_seats(monkeypatch, market, VendorAssignmentResult(
            email=ANA, date=SUN, table_code="Landing 1", table_choice="Full Table",
            section="Landing", tier="Silver", location="Main Hall"))

        PlacementsApi.run_assignment(MARKET, ADMIN)

        [entry] = taken_back(stores)
        assert (entry["subject"]["date"], entry["detail"]) == (
            SUN, {"before": {"owed_cents": 0}, "after": {"owed_cents": 3000}})

    def test_a_swap_clears_a_stale_record_beside_its_two_seats(
            self, admin, stores, applications):  # noqa: F811
        applications.insert_one({"id": "app-ben", "market_id": MARKET, "applicant_email": BEN,
                                 "form_data": {}, "status": "reviewer_approved",
                                 "application_type": "main"})
        PlacementsApi.write_placement(MARKET, seat(SUN, "Landing 1", BEN), ADMIN)
        a_stale_freed_record(SUN)

        PlacementsApi.swap_placements(MARKET, SUN, ANA, BEN, ADMIN)

        [record] = stores.owed.documents
        assert (record["freed"], record["set_by_hand"]) == (None, None)
        sunday = line(SUN)
        assert (sunday["tableCode"], sunday["owedCents"], sunday["owedByFree"]) == (
            "Landing 1", 3000, False)
        assert taken_back(stores) == []

    def test_a_move_of_a_held_day_clears_its_stale_record_with_no_entry(self, admin, stores):  # noqa: F811
        a_stale_freed_record(SUN)

        PlacementsApi.write_placement(MARKET, seat(SUN), ADMIN)

        [record] = stores.owed.documents
        assert (record["freed"], record["set_by_hand"]) == (None, None)
        assert taken_back(stores) == []

    def test_a_re_seat_of_a_freed_day_records_the_taking_back(self, admin, stores):  # noqa: F811
        PlacementsApi.remove_placement(MARKET, ANA, SUN, ADMIN, deduct_owed=True)

        PlacementsApi.write_placement(MARKET, seat(SUN), ADMIN)

        [entry] = taken_back(stores)
        assert entry["detail"] == {"before": {"owed_cents": 0}, "after": {"owed_cents": 3000}}

