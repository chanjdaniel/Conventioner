"""The Stats tab's How full: each section's tables used on each market day, of its tables (T201).

Counted from the stored assignment's rows as the Assignments page counts them
(``counted_assignment``), one row per table and date, a table with anyone at it used, half held
included, as the "table-days free" figure counts it, so the grid's cells add up to the headlines'
table-days used, and its empty cells to the table-days free. ``None`` until an assignment is
stored, as the placements headlines are.
"""
import copy

from test_the_stats_headlines import (
    _live, _place_the_not_approved, _seat_and_pay, applied,  # noqa: F401
)
from test_the_payments_page import EDITOR, MARKET, SAT, SUN

import api.markets as MarketsApi
import api.placements as PlacementsApi
import market_stats as MarketStats
from test_a_vendors_payments import PLAN


def stats():
    market = MarketsApi.load_market_context(MARKET).market
    return MarketStats.stats_for_market(market)


def cells(fill):
    """Each section's row as (section, tier, [(date, used, tables), ...])."""
    return [
        (row["section"], row["tier"],
         [(cell["date"], cell["used"], cell["tables"]) for cell in row["cells"]])
        for row in fill["sections"]
    ]


class TestHowFull:
    def test_nothing_is_counted_before_an_assignment_is_stored(self, applied, market_records):
        applied(_live())

        assert stats()["fill"] is None

    def test_each_section_on_each_day_counts_its_tables_used_of_its_tables(
            self, applied, market_records):
        applied(_live())
        # Ana holds North Wing 1 both days, Ben Landing 1 on Saturday, Cy the left half of North
        # Wing 2 on Sunday.
        _seat_and_pay()

        fill = stats()["fill"]

        assert fill["dates"] == [SAT, SUN]
        assert cells(fill) == [
            ("North Wing", "Gold", [(SAT, 1, 2), (SUN, 2, 2)]),
            ("Landing", "Silver", [(SAT, 1, 2), (SUN, 0, 2)]),
        ]

    def test_a_table_half_held_is_used(self, applied, market_records):
        applied(_live())
        PlacementsApi.write_placement(
            MARKET, {"email": "cy@example.com", "date": SUN, "table_code": "North Wing 2",
                     "table_choice": "Half Table (Left)"},
            EDITOR)

        assert cells(stats()["fill"])[0] == ("North Wing", "Gold", [(SAT, 0, 2), (SUN, 1, 2)])

    def test_its_cells_add_up_to_the_headlines_used_and_free(self, applied, market_records):
        applied(_live())
        _seat_and_pay()

        figures = stats()
        every = [cell for row in figures["fill"]["sections"] for cell in row["cells"]]
        placements = figures["headlines"]["placements"]

        assert sum(cell["used"] for cell in every) == placements["tableDaysUsed"] == 4
        assert sum(cell["tables"] for cell in every) == placements["tableDays"] == 8
        assert sum(cell["tables"] - cell["used"] for cell in every) == (
            placements["tableDaysFree"]) == 4

    def test_an_applicant_placed_while_not_approved_is_counted_as_the_headlines_count_them(
            self, applied, applications, market_records):
        applied(_live())
        _seat_and_pay()
        _place_the_not_approved(applications)

        figures = stats()
        placements = figures["headlines"]["placements"]

        # Fay on Saturday's and Gus on Sunday's Landing 2.
        assert cells(figures["fill"])[1] == ("Landing", "Silver", [(SAT, 2, 2), (SUN, 1, 2)])
        every = [cell for row in figures["fill"]["sections"] for cell in row["cells"]]
        assert sum(cell["used"] for cell in every) == placements["tableDaysUsed"] == 6
        assert sum(cell["tables"] - cell["used"] for cell in every) == (
            placements["tableDaysFree"]) == 2

    def test_a_section_with_no_tier_says_none(self, applied, market_records):
        plan = copy.deepcopy(PLAN)
        del plan["sections"][1]["tier"]
        applied(_live(plan))
        _seat_and_pay()

        assert [(section, tier) for section, tier, _ in cells(stats()["fill"])] == [
            ("North Wing", "Gold"), ("Landing", None),
        ]
