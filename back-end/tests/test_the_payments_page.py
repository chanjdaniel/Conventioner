"""The Payments page: the market's money at a glance (E44/F02/S01).

Every vendor with a table-day line or a payment, each with what they owe and what they paid, and
the market's totals: the amount owed (every table-day line), the amount paid, what is still owed
and what was paid more than owed, each also by tier and by date. A payment is a vendor's, not a
day's, so what each vendor paid is shared across their table-days in proportion to what each owes;
every breakdown adds up to the totals, and the totals to the vendors' own Payment tabs.
"""
import copy

import pytest

from conftest import stored_market
from test_a_vendors_payments import PLAN, LiveMarket

import api.markets as MarketsApi
import api.payments as PaymentsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import payments as Payments
from client_errors import ForbiddenError
from datatypes import MarketPhase, MarketRole

MARKET = "market-123"
EDITOR = "editor@example.com"
SAT, SUN = "2099-05-07", "2099-05-08"
#: Ana holds Gold on both days and owes half of it; Ben holds Silver on Saturday, paid in full;
#: Cy holds half a Gold table on Sunday and paid $7.50 more; Dee holds nothing and paid $10.
ANA, BEN, CY, DEE = ("ana@example.com", "ben@example.com", "cy@example.com", "dee@example.com")
SEATS = [
    (ANA, SAT, "North Wing 1", "Full Table"),
    (ANA, SUN, "North Wing 1", "Full Table"),
    (BEN, SAT, "Landing 1", "Full Table"),
    (CY, SUN, "North Wing 2", "Half Table (Left)"),
]
PAID = {ANA: 3500, BEN: 3000, CY: 2500, DEE: 1000}


def pay(email, cents, by=EDITOR):
    PaymentsApi.record_payment(
        MARKET, email, {"cents": cents, "method": "e-transfer", "paidOn": "2099-04-01", "note": ""},
        by)


@pytest.fixture
def market(monkeypatch, applications):
    live = LiveMarket(stored_market(phase=MarketPhase.MARKET_DAYS, setupObject=copy.deepcopy(PLAN)))
    monkeypatch.setattr(MarketsApi, "markets_collection", live)
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    for email in (ANA, BEN, CY, DEE, "eve@example.com"):
        applications.insert_one({"id": f"app-{email}", "market_id": MARKET,
                                 "applicant_email": email, "form_data": {},
                                 "status": "reviewer_approved", "application_type": "main"})
    for email, date, table, choice in SEATS:
        PlacementsApi.write_placement(
            MARKET, {"email": email, "date": date, "table_code": table, "table_choice": choice},
            EDITOR)
    for email, cents in PAID.items():
        pay(email, cents)
    return live


def page():
    return PaymentsApi.market_payments(MARKET, EDITOR)


FIGURES = ("owedCents", "paidCents", "stillOwedCents", "paidMoreCents")


def figures(row):
    return tuple(row[key] for key in FIGURES)


class TestTheVendors:
    def test_every_vendor_with_a_line_or_a_payment_is_listed_once(self, market):
        got = page()

        # Eve applied and holds nothing and paid nothing, so she is not on the page.
        assert [v["email"] for v in got["vendors"]] == [ANA, BEN, CY, DEE]
        assert {v["email"]: (v["owedCents"], v["paidCents"]) for v in got["vendors"]} == {
            ANA: (7000, 3500), BEN: (3000, 3000), CY: (1750, 2500), DEE: (0, 1000)}
        assert got["currency"] == "CAD"

    def test_each_vendor_reads_as_their_payment_tab_does(self, market):
        for vendor in page()["vendors"]:
            tab = PaymentsApi.vendor_account(MARKET, vendor["email"], EDITOR)
            assert (vendor["owedCents"], vendor["paidCents"]) == (
                tab["owedCents"], tab["paidCents"])

    def test_a_freed_day_keeps_its_line_on_the_page(self, market):
        PlacementsApi.remove_placement(MARKET, BEN, SAT, EDITOR)

        ben = next(v for v in page()["vendors"] if v["email"] == BEN)
        assert (ben["owedCents"], ben["paidCents"]) == (3000, 3000)

    def test_each_vendor_carries_the_state_the_export_filters_by(self, market):
        # One definition for the page's lists and the export's payment filter (E42/F01/S04).
        got = page()
        assert {v["email"]: v["balanceState"] for v in got["vendors"]} == {
            ANA: Payments.OWES, BEN: Payments.PAID_IN_FULL, CY: Payments.PAID_MORE,
            DEE: Payments.PAID_MORE}
        for vendor in got["vendors"]:
            tab = PaymentsApi.vendor_account(MARKET, vendor["email"], EDITOR)
            assert vendor["balanceState"] == Payments.balance_state(tab)

    def test_a_vendor_owing_nothing_and_paying_nothing_is_in_no_state(
            self, market, market_records):
        entry = next(doc for doc in market_records.payments.documents if doc["vendor_email"] == DEE)
        PaymentsApi.remove_payment(MARKET, entry["id"], EDITOR)

        dee = next(v for v in page()["vendors"] if v["email"] == DEE)
        assert dee["balanceState"] is None

    def test_a_removed_payment_pays_nothing(self, market, market_records):
        entry = next(doc for doc in market_records.payments.documents if doc["vendor_email"] == DEE)
        PaymentsApi.remove_payment(MARKET, entry["id"], EDITOR)

        dee = next(v for v in page()["vendors"] if v["email"] == DEE)
        assert (dee["owedCents"], dee["paidCents"]) == (0, 0)


class TestTheTotals:
    def test_the_totals_match_the_sum_of_the_vendors_payment_tabs(self, market):
        tabs = [PaymentsApi.vendor_account(MARKET, email, EDITOR) for email in (ANA, BEN, CY, DEE)]
        owed = sum(tab["owedCents"] for tab in tabs)
        paid = sum(tab["paidCents"] for tab in tabs)
        still = sum(max(tab["owedCents"] - tab["paidCents"], 0) for tab in tabs)
        more = sum(max(tab["paidCents"] - tab["owedCents"], 0) for tab in tabs)

        assert figures(page()["totals"]) == (owed, paid, still, more) == (11750, 10000, 3500, 1750)

    def test_by_tier_shares_each_vendors_payment_across_their_days(self, market):
        assert [(row["tier"], *figures(row)) for row in page()["byTier"]] == [
            # Ana's $35 is shared across her two $35 days; Cy's $25 is all on her one day.
            ("Gold", 8750, 6000, 3500, 750),
            ("Silver", 3000, 3000, 0, 0),
            # Dee paid with no table, so her $10 is counted apart.
            (None, 0, 1000, 0, 1000),
        ]

    def test_by_date(self, market):
        assert [(row["date"], *figures(row)) for row in page()["byDate"]] == [
            (SAT, 6500, 4750, 1750, 0),
            (SUN, 5250, 4250, 1750, 750),
            (None, 0, 1000, 0, 1000),
        ]

    def test_a_vendor_with_no_table_whose_payment_was_removed_adds_no_row(
            self, market, market_records):
        # Dee is still listed, owing and paying nothing, but a "No table" row of four $0 figures
        # would be noise in both breakdowns.
        entry = next(doc for doc in market_records.payments.documents if doc["vendor_email"] == DEE)
        PaymentsApi.remove_payment(MARKET, entry["id"], EDITOR)

        got = page()
        assert DEE in [v["email"] for v in got["vendors"]]
        assert [row["tier"] for row in got["byTier"]] == ["Gold", "Silver"]
        assert [row["date"] for row in got["byDate"]] == [SAT, SUN]

    def test_each_breakdown_adds_up_to_the_totals(self, market):
        got = page()
        for breakdown in ("byTier", "byDate"):
            sums = tuple(sum(row[key] for row in got[breakdown]) for key in FIGURES)
            assert sums == figures(got["totals"])

    def test_a_share_that_does_not_divide_keeps_every_cent(self, market):
        # $35.01 across two $35 days: one day takes the odd cent, and nothing is lost.
        pay(ANA, 1)

        gold = next(row for row in page()["byTier"] if row["tier"] == "Gold")
        assert gold["paidCents"] == 6001
        assert gold["stillOwedCents"] == 3499

    def test_a_vendor_owing_nothing_shares_their_payment_evenly(self, market):
        for date in (SAT, SUN):
            Payments.set_amount_owed(MARKET, ANA, date, 0, "admin@example.com")

        by_date = {row["date"]: figures(row) for row in page()["byDate"]}
        # Ana's $35 is now all paid more than owed, half on each day.
        assert by_date[SAT] == (3000, 4750, 0, 1750)
        assert by_date[SUN] == (1750, 4250, 0, 2500)

    def test_a_tier_reads_in_the_markets_order(self, market):
        market.doc["setupObject"]["tiers"] = [{"id": 2, "name": "Silver"}, {"id": 1, "name": "Gold"}]

        assert [row["tier"] for row in page()["byTier"]] == ["Silver", "Gold", None]

    def test_a_market_with_no_prices_lists_its_vendors_owing_nothing(self, market):
        market.doc["setupObject"]["pricing"] = None

        got = page()
        assert got["currency"] is None
        assert {v["email"]: v["owedCents"] for v in got["vendors"]} == {
            ANA: 0, BEN: 0, CY: 0, DEE: 0}
        assert got["totals"]["owedCents"] == 0

    def test_a_market_with_no_prices_puts_nobody_in_a_payment_state(self, market):
        # Nothing is priced, so a payment there is not "more than owed" (finding 8): the page
        # offers no filter there, and the export's payment filter reads no state there either.
        market.doc["setupObject"]["pricing"] = None

        assert {v["email"]: v["balanceState"] for v in page()["vendors"]} == {
            ANA: None, BEN: None, CY: None, DEE: None}

    @pytest.mark.parametrize("owed, state", [(2000, Payments.PAID_MORE), (4000, Payments.OWES),
                                             (3000, Payments.PAID_IN_FULL)])
    def test_an_amount_set_by_hand_on_a_market_with_no_prices_reads_as_anywhere(
            self, market, owed, state):
        # The reading follows the account, not the market (finding 10): Ben paid $30, and an
        # amount owed set by hand holds on a market with no prices, so he owes, is square, or paid
        # more than owed like anyone; the others, owing nothing, are in no state.
        market.doc["setupObject"]["pricing"] = None
        Payments.set_amount_owed(MARKET, BEN, SAT, owed, "admin@example.com")

        assert {v["email"]: v["balanceState"] for v in page()["vendors"]} == {
            ANA: None, BEN: state, CY: None, DEE: None}

    def test_an_amount_set_by_hand_on_a_market_with_no_prices_is_summed_by_the_account(
            self, market):
        # The figures follow the account as the rows do (T153 review finding 12): Ben owes $20
        # set by hand and paid $30, $10 more than owed; the others owe nothing, so what they paid
        # counts toward "Paid" but is never "more than owed", in the totals or any share of them.
        market.doc["setupObject"]["pricing"] = None
        Payments.set_amount_owed(MARKET, BEN, SAT, 2000, "admin@example.com")

        got = page()
        assert figures(got["totals"]) == (2000, 10000, 0, 1000)
        assert [(row["tier"], *figures(row)) for row in got["byTier"]] == [
            ("Gold", 0, 6000, 0, 0),
            ("Silver", 2000, 3000, 0, 1000),
            (None, 0, 1000, 0, 0),
        ]
        assert [(row["date"], *figures(row)) for row in got["byDate"]] == [
            (SAT, 2000, 4750, 0, 1000),
            (SUN, 0, 4250, 0, 0),
            (None, 0, 1000, 0, 0),
        ]
        for breakdown in ("byTier", "byDate"):
            sums = tuple(sum(row[key] for row in got[breakdown]) for key in FIGURES)
            assert sums == figures(got["totals"])

    def test_a_refund_beyond_what_was_paid_on_a_market_with_no_prices_owes_it_back(
            self, market, market_records):
        # A negative net paid is money owed back to the market (T153 review finding 14): Ana,
        # owing nothing, had her $35 removed and $15 refunded, so she owes $15, in her state, the
        # totals and her days' shares alike; Ben owes $20 by hand and paid $30.
        market.doc["setupObject"]["pricing"] = None
        Payments.set_amount_owed(MARKET, BEN, SAT, 2000, "admin@example.com")
        entry = next(doc for doc in market_records.payments.documents if doc["vendor_email"] == ANA)
        PaymentsApi.remove_payment(MARKET, entry["id"], EDITOR)
        PaymentsApi.record_refund(
            MARKET, ANA, {"cents": 1500, "method": "e-transfer", "paidOn": "2099-04-02", "note": ""},
            EDITOR)

        got = page()
        assert {v["email"]: v["balanceState"] for v in got["vendors"]} == {
            ANA: Payments.OWES, BEN: Payments.PAID_MORE, CY: None, DEE: None}
        assert figures(got["totals"]) == (2000, 5000, 1500, 1000)
        assert [(row["tier"], *figures(row)) for row in got["byTier"]] == [
            ("Gold", 0, 1000, 1500, 0),
            ("Silver", 2000, 3000, 0, 1000),
            (None, 0, 1000, 0, 0),
        ]
        assert [(row["date"], *figures(row)) for row in got["byDate"]] == [
            (SAT, 2000, 2250, 750, 1000),
            (SUN, 0, 1750, 750, 0),
            (None, 0, 1000, 0, 0),
        ]

    def test_a_market_with_nobody_reads_empty(self, market, market_records):
        market_records.payments.documents.clear()
        market.doc["assignmentObject"] = {"vendorAssignments": [], "assignmentStatistics": None}

        got = page()
        assert (got["vendors"], got["byTier"], got["byDate"]) == ([], [], [])
        assert figures(got["totals"]) == (0, 0, 0, 0)


class TestWhoMay:
    def test_a_viewer_reads_the_page(self, market, monkeypatch):
        monkeypatch.setattr(
            PermissionsApi, "user_has_permission",
            lambda _u, _m, required, *_a, **_k: PermissionsApi.role_reaches(
                MarketRole.VIEWER, required))

        assert page()["totals"]["owedCents"] == 11750

    def test_someone_with_no_role_is_refused(self, market, monkeypatch):
        monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: False)

        with pytest.raises(ForbiddenError):
            page()
