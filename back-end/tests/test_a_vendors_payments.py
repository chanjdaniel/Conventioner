"""A vendor's payments: what they owe for each table-day, and what they have paid (E44/F01/S01).

The amount owed is kept per table-day: the pricing calculates it from the seat the vendor holds,
and follows the seat while nobody has set it by hand (Daniel, T92 Q26). The amount paid is the sum
of the payments an Editor records, each with who recorded it and when (Q15, Q7b). Freeing a table
never changes either amount by itself: the table-day's line stays, marked freed, still owed (Q26).
"""
import copy
from types import SimpleNamespace

import pytest

from conftest import FakeApplicationsCollection, FakeMarketsCollection, stored_market

import api.markets as MarketsApi
import api.payments as PaymentsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import api.market_actions as Actions
import history as History
import payments as Payments
from client_errors import BadRequestError, ForbiddenError, NotFoundError
from datatypes import MarketPhase, MarketRole

MARKET = "market-123"
ANA = "ana@example.com"
EDITOR = "editor@example.com"
SAT, SUN = "2099-05-07", "2099-05-08"

PLAN = {
    "priority": [],
    "marketDates": [{"date": SAT}, {"date": SUN}],
    "tiers": [{"id": 1, "name": "Gold"}, {"id": 2, "name": "Silver"}],
    "locations": [{"name": "Main Hall"}],
    "sections": [
        {"name": "Atrium", "location": {"name": "Main Hall"}, "tier": {"id": 1, "name": "Gold"},
         "count": 2},
        {"name": "Landing", "location": {"name": "Main Hall"},
         "tier": {"id": 2, "name": "Silver"}, "count": 2},
    ],
    "assignmentOptions": {"maxAssignmentsPerVendor": 2, "maxHalfTableProportionPerSection": 50},
    "pricing": {"currency": "CAD", "halfTablePercent": 50,
                "everyoneElse": [{"tier": "Gold", "cents": 3500}, {"tier": "Silver", "cents": 3000}]},
}


class LiveMarket(FakeMarketsCollection):
    """The one market, applying each ``$set`` the way Mongo does, so a placement written is the
    placement the next read finds."""

    def update_one(self, _filter, update):
        result = super().update_one(_filter, update)
        for key, value in (update.get("$set") or {}).items():
            *parents, last = key.split(".")
            target = self.doc
            for part in parents:
                target = target.setdefault(part, {})
            target[last] = copy.deepcopy(value)
        return result


@pytest.fixture
def market(monkeypatch, applications):
    """A priced market in market days, Ana holding a Gold full table on both days."""
    live = LiveMarket(stored_market(phase=MarketPhase.MARKET_DAYS, setupObject=copy.deepcopy(PLAN)))
    monkeypatch.setattr(MarketsApi, "markets_collection", live)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    applications.insert_one({"id": "app-ana", "market_id": MARKET, "applicant_email": ANA,
                             "form_data": {}, "status": "reviewer_approved",
                             "application_type": "main"})
    for date in (SAT, SUN):
        PlacementsApi.write_placement(
            MARKET, {"email": ANA, "date": date, "table_code": "Atrium 1",
                     "table_choice": "Full Table"}, EDITOR)
    return live


@pytest.fixture(autouse=True)
def stores(monkeypatch, market_records):
    return SimpleNamespace(payments=market_records.payments, owed=market_records.amounts_owed,
                           history=market_records.history)


def account():
    return PaymentsApi.vendor_account(MARKET, ANA, EDITOR)


def pay(cents, method="e-transfer", paid_on="2099-04-01", note="", by=EDITOR):
    return PaymentsApi.record_payment(
        MARKET, ANA, {"cents": cents, "method": method, "paidOn": paid_on, "note": note}, by)


def owed(lines):
    return [(line["date"], line["tableCode"], line["owedCents"], line["freed"]) for line in lines]


class TestTheAmountOwed:
    def test_two_gold_full_days_owe_seventy_dollars(self, market):
        got = account()

        assert owed(got["lines"]) == [(SAT, "Atrium 1", 3500, False), (SUN, "Atrium 1", 3500, False)]
        assert got["lines"][0]["tier"] == "Gold"
        assert got["lines"][0]["tableChoice"] == "Full Table"
        assert got["lines"][0]["group"] is None
        assert (got["owedCents"], got["paidCents"], got["currency"]) == (7000, 0, "CAD")

    def test_a_half_table_owes_the_half_share(self, market):
        PlacementsApi.write_placement(MARKET, {"email": ANA, "date": SUN, "table_code": "Landing 1",
                                               "table_choice": "Half Table (Left)"}, EDITOR)

        assert owed(account()["lines"])[1] == (SUN, "Landing 1", 1500, False)

    def test_a_seat_moved_from_gold_to_silver_owes_the_silver_price(self, market):
        PlacementsApi.write_placement(MARKET, {"email": ANA, "date": SAT, "table_code": "Landing 2",
                                               "table_choice": "Full Table"}, EDITOR)

        got = account()
        assert owed(got["lines"])[0] == (SAT, "Landing 2", 3000, False)
        assert got["lines"][0]["tier"] == "Silver"
        assert got["owedCents"] == 6500

    def test_an_amount_set_by_hand_stays_when_the_seat_moves(self, market):
        Payments.set_amount_owed(MARKET, ANA, SAT, 2000, "admin@example.com")

        PlacementsApi.write_placement(MARKET, {"email": ANA, "date": SAT, "table_code": "Landing 2",
                                               "table_choice": "Full Table"}, EDITOR)

        line = account()["lines"][0]
        assert (line["tableCode"], line["owedCents"]) == ("Landing 2", 2000)
        assert line["owedSetBy"] == "admin@example.com"

    def test_a_vendor_in_a_price_group_owes_the_groups_price_and_the_line_names_it(
        self, market, applications,
    ):
        """E43/F01/S02: the line is priced as the date card is, by the groups their answers put
        them in."""
        from test_price_groups import FIELDS, STUDENT, UBC_TABLE

        market.doc["applicationForm"] = {"fields": FIELDS}
        market.doc["setupObject"]["pricing"] = copy.deepcopy(UBC_TABLE)
        applications.documents[0]["form_data"] = {"affiliation": [STUDENT], "clubs": ["Art Club"]}

        got = account()

        assert [(line["owedCents"], line["group"]) for line in got["lines"]] == [
            (1200, "UBC student + club member"), (1200, "UBC student + club member")]
        PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR)
        assert account()["lines"][1]["group"] == "UBC student + club member"

    def test_a_market_with_no_prices_owes_nothing_and_says_so(self, market):
        market.doc["setupObject"]["pricing"] = None

        got = account()
        assert [line["owedCents"] for line in got["lines"]] == [None, None]
        assert (got["owedCents"], got["currency"]) == (0, None)

    def test_a_vendor_with_no_table_owes_nothing(self, market):
        got = PaymentsApi.vendor_account(MARKET, "ben@example.com", EDITOR)

        assert (got["lines"], got["owedCents"], got["paidCents"]) == ([], 0, 0)


class TestFreeingATable:
    def test_freeing_a_paid_day_keeps_its_line_and_changes_neither_amount(self, market):
        pay(7000)

        PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR)

        got = account()
        assert owed(got["lines"]) == [(SAT, "Atrium 1", 3500, False), (SUN, "Atrium 1", 3500, True)]
        assert got["lines"][1]["tier"] == "Gold"
        assert got["lines"][1]["freedBy"] == EDITOR
        assert got["lines"][1]["freedAt"]
        assert got["lines"][0]["freedAt"] is None
        assert (got["owedCents"], got["paidCents"]) == (7000, 7000)

    def test_a_freed_day_seated_again_follows_its_new_seat(self, market):
        PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR)
        PlacementsApi.write_placement(MARKET, {"email": ANA, "date": SUN, "table_code": "Landing 1",
                                               "table_choice": "Full Table"}, EDITOR)

        assert owed(account()["lines"])[1] == (SUN, "Landing 1", 3000, False)

    def test_seating_a_freed_day_again_forgets_its_freed_line(self, market, stores):
        """Review 1's note 3: a freed record left behind would come back as the line if the new
        seat went some other way than a free."""
        PlacementsApi.remove_placement(MARKET, ANA, SUN, EDITOR)
        assert stores.owed.documents[0]["freed"]

        PlacementsApi.write_placement(MARKET, {"email": ANA, "date": SUN, "table_code": "Landing 1",
                                               "table_choice": "Full Table"}, EDITOR)

        assert stores.owed.documents[0]["freed"] is None
        market.doc["assignmentObject"]["vendorAssignments"] = [
            seat for seat in market.doc["assignmentObject"]["vendorAssignments"]
            if seat["date"] != SUN]
        assert [line["date"] for line in account()["lines"]] == [SAT]

    def test_a_run_that_seats_a_freed_day_forgets_its_freed_line(self, stores):
        Payments.keep_freed_line(MARKET, ANA, SUN, Payments.Seat("Atrium 1", "Gold", "Full Table",
                                                                 3500), EDITOR)
        Payments.keep_freed_line(MARKET, ANA, SAT, Payments.Seat("Atrium 1", "Gold", "Full Table",
                                                                 3500), EDITOR)

        Payments.clear_freed_lines(MARKET, [("Ana@Example.com", SUN)])

        kept = {doc["date"]: doc["freed"] for doc in stores.owed.documents}
        assert kept[SUN] is None and kept[SAT]

    def test_freeing_a_seat_nobody_holds_keeps_no_line(self, market, stores):
        PlacementsApi.remove_placement(MARKET, "ben@example.com", SUN, EDITOR)

        assert stores.owed.documents == []


class TestRecordingAPayment:
    def test_payments_add_up_to_what_is_paid(self, market):
        pay(3500)
        assert (account()["owedCents"], account()["paidCents"]) == (7000, 3500)

        pay(3500, method="cash", paid_on="2099-04-02", note="At the info desk")

        got = account()
        assert got["paidCents"] == 7000
        newest = got["payments"][0]
        assert (newest["cents"], newest["method"], newest["paidOn"], newest["note"]) == (
            3500, "cash", "2099-04-02", "At the info desk")
        assert newest["recordedBy"] == EDITOR
        assert newest["recordedAt"]
        assert newest["id"]

    def test_recording_answers_the_account_as_it_now_reads(self, market):
        assert pay(3500)["paidCents"] == 3500

    @pytest.mark.parametrize("what, body", [
        ("no amount", {"method": "cash", "paidOn": "2099-04-01"}),
        ("a zero amount", {"cents": 0, "method": "cash", "paidOn": "2099-04-01"}),
        ("a negative amount", {"cents": -100, "method": "cash", "paidOn": "2099-04-01"}),
        ("an amount as text", {"cents": "3500", "method": "cash", "paidOn": "2099-04-01"}),
        ("a fraction of a cent", {"cents": 35.5, "method": "cash", "paidOn": "2099-04-01"}),
        ("an amount past a hundred thousand dollars",
         {"cents": 10_000_001, "method": "cash", "paidOn": "2099-04-01"}),
        ("a method that is neither", {"cents": 3500, "method": "cheque", "paidOn": "2099-04-01"}),
        ("no date", {"cents": 3500, "method": "cash"}),
        ("a date that is no date", {"cents": 3500, "method": "cash", "paidOn": "next Tuesday"}),
        ("a note past 500 characters",
         {"cents": 3500, "method": "cash", "paidOn": "2099-04-01", "note": "x" * 501}),
        ("a note that is not text",
         {"cents": 3500, "method": "cash", "paidOn": "2099-04-01", "note": {"$ne": ""}}),
    ])
    def test_it_refuses(self, market, stores, what, body):
        with pytest.raises(BadRequestError):
            PaymentsApi.record_payment(MARKET, ANA, body, EDITOR)
        assert stores.payments.documents == []

    def test_it_refuses_someone_the_market_has_no_application_from(self, market, stores):
        with pytest.raises(NotFoundError):
            PaymentsApi.record_payment(
                MARKET, "ben@example.com",
                {"cents": 3500, "method": "cash", "paidOn": "2099-04-01"}, EDITOR)
        assert stores.payments.documents == []

    def test_an_archived_market_refuses_it(self, market, stores):
        market.doc["phase"] = MarketPhase.ARCHIVED.value

        with pytest.raises(ForbiddenError):
            pay(3500)
        assert stores.payments.documents == []


class TestWhoMay:
    def test_recording_a_payment_is_its_own_row_an_editors(self):
        assert Actions.RECORD_PAYMENT.id == "record-payment"
        assert Actions.RECORD_PAYMENT.label == "Record a payment"
        assert Actions.RECORD_PAYMENT.default is MarketRole.EDITOR

    @pytest.fixture
    def viewer(self, market, monkeypatch):
        monkeypatch.setattr(
            PermissionsApi, "user_has_permission",
            lambda _u, _m, required, *_a, **_k: PermissionsApi.role_reaches(
                MarketRole.VIEWER, required))

    def test_a_viewer_reads_the_account(self, viewer):
        assert account()["owedCents"] == 7000

    def test_a_viewer_may_not_record_a_payment(self, viewer, stores):
        with pytest.raises(ForbiddenError) as refused:
            pay(3500, by="viewer@example.com")

        assert str(refused.value) == (
            "Only an Editor, an Admin or the owner may record payments on this market.")
        assert stores.payments.documents == []

    def test_a_row_set_to_admin_refuses_an_editor(self, market, monkeypatch, stores):
        market.doc["permissions"] = {"record-payment": {"role": "admin", "source": "market"}}
        monkeypatch.setattr(
            PermissionsApi, "user_has_permission",
            lambda _u, _m, required, *_a, **_k: PermissionsApi.role_reaches(
                MarketRole.EDITOR, required))

        with pytest.raises(ForbiddenError):
            pay(3500)
        assert stores.payments.documents == []


class TestTheHistory:
    def test_a_payment_is_recorded_with_who_and_what(self, market, stores):
        stores.history.documents.clear()

        pay(3500, method="cash", note="At the info desk")

        [entry] = stores.history.documents
        assert (entry["actor"], entry["action"], entry["kind"]) == (EDITOR, "record-payment", None)
        assert entry["vendors"] == [ANA]
        assert entry["subject"] == {
            "payment_id": account()["payments"][0]["id"], "payment_kind": "payment", "currency": "CAD"}
        assert entry["detail"] == {
            "before": {"cents": None, "method": None, "paid_on": None, "note": None},
            "after": {"cents": 3500, "method": "cash", "paid_on": "2099-04-01",
                      "note": "At the info desk"},
        }

    def test_a_payment_with_no_note_records_none(self, market, stores):
        stores.history.documents.clear()

        pay(3500)

        assert "note" not in stores.history.documents[0]["detail"]["after"]


class TestTheRecordsGoWithTheMarket:
    def test_deleting_the_market_deletes_its_payments_and_amounts_owed(self, market, stores):
        pay(3500)
        Payments.set_amount_owed(MARKET, ANA, SAT, 2000, "admin@example.com")
        Payments.set_amount_owed("another-market", ANA, SAT, 1000, "admin@example.com")

        MarketsApi.MarketDeletion.delete_market_and_records(market, MARKET)

        assert stores.payments.documents == []
        assert [doc["market_id"] for doc in stores.owed.documents] == ["another-market"]
