"""The Stats tab's headlines: the market's placements and money, at its top (E45/F01/S03).

Each figure is the one the page it links to shows, counted by the same code: the table-days used
and the vendors unassigned are the Assignments page's strip (``get_assignment_statistics``), the
table-days free its "Empty" count (the rows of ``get_market_tables`` with nobody at them), and the
amounts owed, paid and still owed the Payments page's figures (``market_payments``). Money is told
only where the market sets prices and the Payments page has someone to count; placements only once
an assignment is stored, as the Assignments page's strip is.
"""
import copy

import pytest

from conftest import stored_market
from test_a_vendors_payments import PLAN, LiveMarket
from test_the_payments_page import EDITOR, MARKET, PAID, SEATS, pay

import api.markets as MarketsApi
import api.payments as PaymentsApi
import api.permissions as PermissionsApi
import api.placements as PlacementsApi
import market_stats as MarketStats
from datatypes import MarketPhase

#: Five approved vendors; four hold or paid something, and Eve holds nothing and paid nothing.
VENDORS = sorted({email for email, *_ in SEATS} | set(PAID) | {"eve@example.com"})


def _live(plan=PLAN):
    return LiveMarket(stored_market(phase=MarketPhase.MARKET_DAYS, setupObject=copy.deepcopy(plan)))


@pytest.fixture
def applied(monkeypatch, applications):
    """The vendors applied and approved, on a market the test chooses."""
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    for email in VENDORS:
        applications.insert_one({"id": f"app-{email}", "market_id": MARKET,
                                 "applicant_email": email, "form_data": {},
                                 "status": "reviewer_approved", "application_type": "main"})

    def on(live):
        monkeypatch.setattr(MarketsApi, "markets_collection", live)
        return live
    return on


def _seat_and_pay():
    for email, date, table, choice in SEATS:
        PlacementsApi.write_placement(
            MARKET, {"email": email, "date": date, "table_code": table, "table_choice": choice},
            EDITOR)
    for email, cents in PAID.items():
        pay(email, cents)


def headlines():
    market = MarketsApi.load_market_context(MARKET).market
    return MarketStats.stats_for_market(market)["headlines"]


class TestThePlacements:
    def test_each_figure_is_the_assignments_pages(self, applied, market_records):
        applied(_live())
        _seat_and_pay()

        strip, status = MarketsApi.get_assignment_statistics(MARKET, EDITOR)
        tables, _ = MarketsApi.get_market_tables(MARKET, EDITOR)
        assert status == 200
        empty = [row for row in tables["rows"] if not any(row["assignmentSlots"])]

        assert headlines()["placements"] == {
            "tableDaysUsed": strip["totalAssignedTables"],
            "tableDays": strip["totalTables"],
            "tableDaysFree": len(empty),
            "unassigned": len(strip["unassignedVendors"]),
        }
        # Two dates of four tables; Ana holds North Wing 1 both days, Ben Landing 1 on Saturday,
        # Cy half of North Wing 2 on Sunday, which is used though half of it is free.
        assert headlines()["placements"] == {
            "tableDaysUsed": 4, "tableDays": 8, "tableDaysFree": 4, "unassigned": 2}

    def test_nothing_is_counted_before_an_assignment_is_stored(self, applied, market_records):
        applied(_live())

        assert headlines()["placements"] is None


class TestTheMoney:
    def test_each_figure_is_the_payments_pages(self, applied, market_records):
        applied(_live())
        _seat_and_pay()

        totals = PaymentsApi.market_payments(MARKET, EDITOR)["totals"]
        assert headlines()["money"] == {
            "currency": "CAD",
            "owedCents": totals["owedCents"],
            "paidCents": totals["paidCents"],
            "stillOwedCents": totals["stillOwedCents"],
        } == {"currency": "CAD", "owedCents": 11750, "paidCents": 10000, "stillOwedCents": 3500}

    def test_a_market_without_prices_tells_no_money(self, applied, market_records):
        applied(_live({**PLAN, "pricing": None}))
        _seat_and_pay()

        assert headlines()["money"] is None
        assert headlines()["placements"] is not None

    def test_a_priced_market_with_nobody_to_count_tells_no_money(self, applied, market_records):
        # The Payments page counts nobody yet, so it shows no figures for the headline to match.
        applied(_live())

        assert headlines()["money"] is None
