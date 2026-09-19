"""Why a vendor has no table, computed on read.

The finding this answers: a walk produced five approved applications, three placed, nineteen of
twenty-four table-slots free and two vendors unplaced, with no explanation of the contradiction
anywhere on screen. Both had asked for a tier the market has no sections at.
"""
import pytest

from assignment.vendor_input import SolverVendor
from datatypes import (
    LocationObject,
    MarketDateObject,
    SectionObject,
    SetupObject,
    TierObject,
    AssignmentOptionObject,
)
from placement_reasons import PlacementReason, unplaced_dates


DATES = ["2026-08-01", "2026-08-08"]
GOLD = TierObject(id=1, name="Gold")
SILVER = TierObject(id=2, name="Silver")
HALL = LocationObject(name="Main Hall")


def plan(section_counts=((GOLD, 2),), dates=DATES):
    return SetupObject(
        priority=[],
        market_dates=[MarketDateObject(date=date) for date in dates],
        tiers=[GOLD, SILVER],
        locations=[HALL],
        sections=[
            SectionObject(name=f"Section {tier.name}", location=HALL, tier=tier, count=count)
            for tier, count in section_counts
        ],
        assignment_options=AssignmentOptionObject(),
    )


def vendor(email="nadia@ember.test", available=DATES, tiers=("Gold",), table_choice="full"):
    return SolverVendor(
        application_id=f"app-{email}",
        email=email,
        available_dates=frozenset(available),
        max_dates=len(available),
        accepted_tiers_by_date={date: frozenset(tiers) for date in available},
        table_choice=table_choice,
        table_share_email=None,
        section_ranking=(),
        table_type_ranking=(),
    )


def placement(email, date, table_code, table_choice="Full Table"):
    return {"email": email, "date": date, "table_code": table_code, "table_choice": table_choice}


def reasons(setup, vendors, placements):
    return {(u.email, u.date): u.reason for u in unplaced_dates(setup, vendors, placements)}


class TestTheFourReasons:
    def test_a_date_they_did_not_tick(self):
        result = reasons(plan(), [vendor(available=[DATES[0]])], [])

        assert result[("nadia@ember.test", DATES[1])] == PlacementReason.NOT_AVAILABLE

    def test_a_tier_the_plan_gives_no_tables_to(self):
        """The finding itself: unplaced beside nineteen free tables, because none is their tier."""
        result = reasons(plan(section_counts=((GOLD, 2),)), [vendor(tiers=("Silver",))], [])

        assert result[("nadia@ember.test", DATES[0])] == PlacementReason.NO_TABLE_AT_THEIR_TIER

    def test_every_matching_table_is_occupied(self):
        setup = plan(section_counts=((GOLD, 1),))
        taken = [placement("someone@else.test", DATES[0], "Section Gold 1")]

        result = reasons(setup, [vendor()], taken)

        assert result[("nadia@ember.test", DATES[0])] == PlacementReason.TAKEN

    def test_a_section_at_their_tier_with_no_tables_is_no_tables(self):
        """Counting it would answer "every table they accept is taken" for a market with none."""
        result = reasons(plan(section_counts=((GOLD, 0),)), [vendor()], [])

        assert result[("nadia@ember.test", DATES[0])] == PlacementReason.NO_TABLE_AT_THEIR_TIER

    def test_a_table_they_would_accept_is_open(self):
        """The reason a recorded one could never give: they could be placed right now."""
        result = reasons(plan(), [vendor()], [])

        assert result[("nadia@ember.test", DATES[0])] == PlacementReason.FREE


class TestWhatCountsAsRoom:
    def test_a_half_table_occupant_leaves_a_seat_for_a_half_table_vendor(self):
        setup = plan(section_counts=((GOLD, 1),))
        half = [placement("someone@else.test", DATES[0], "Section Gold 1", "Half Table (Left)")]

        result = reasons(setup, [vendor(table_choice="half")], half)

        assert result[("nadia@ember.test", DATES[0])] == PlacementReason.FREE

    def test_but_not_for_one_who_asked_for_a_whole_table(self):
        setup = plan(section_counts=((GOLD, 1),))
        half = [placement("someone@else.test", DATES[0], "Section Gold 1", "Half Table (Left)")]

        result = reasons(setup, [vendor(table_choice="full")], half)

        assert result[("nadia@ember.test", DATES[0])] == PlacementReason.TAKEN

    def test_a_full_table_occupant_leaves_nothing(self):
        setup = plan(section_counts=((GOLD, 1),))
        full = [placement("someone@else.test", DATES[0], "Section Gold 1", "Full Table")]

        result = reasons(setup, [vendor(table_choice="half")], full)

        assert result[("nadia@ember.test", DATES[0])] == PlacementReason.TAKEN


class TestAPartiallyPlacedVendor:
    """A vendor who asked for two dates and got one has a gap, rendered as an em dash until now."""

    def test_the_date_they_were_placed_on_is_not_reported(self):
        setup = plan()
        placed = [placement("nadia@ember.test", DATES[0], "Section Gold 1")]

        result = reasons(setup, [vendor()], placed)

        assert ("nadia@ember.test", DATES[0]) not in result

    def test_the_date_they_were_not_placed_on_gets_a_reason(self):
        setup = plan(section_counts=((GOLD, 1),))
        placed = [
            placement("nadia@ember.test", DATES[0], "Section Gold 1"),
            placement("someone@else.test", DATES[1], "Section Gold 1"),
        ]

        result = reasons(setup, [vendor()], placed)

        assert result[("nadia@ember.test", DATES[1])] == PlacementReason.TAKEN


class TestComputedRatherThanRecorded:
    """The case that justifies the whole design.

    A recorded reason is true of the moment the solver gave up. This one is true of now: unplacing
    somebody by hand flips their neighbours from TAKEN to FREE with nothing re-run.
    """

    def test_unplacing_a_neighbour_flips_taken_to_free(self):
        setup = plan(section_counts=((GOLD, 1),))
        me = vendor()
        occupied = [placement("someone@else.test", DATES[0], "Section Gold 1")]

        assert reasons(setup, [me], occupied)[(me.email, DATES[0])] == PlacementReason.TAKEN

        # The same question, against an assignment somebody has since edited. No re-run.
        assert reasons(setup, [me], [])[(me.email, DATES[0])] == PlacementReason.FREE

    def test_adding_a_section_at_their_tier_flips_no_table_to_free(self):
        me = vendor(tiers=("Silver",))

        without = reasons(plan(section_counts=((GOLD, 2),)), [me], [])
        with_one = reasons(plan(section_counts=((GOLD, 2), (SILVER, 1))), [me], [])

        assert without[(me.email, DATES[0])] == PlacementReason.NO_TABLE_AT_THEIR_TIER
        assert with_one[(me.email, DATES[0])] == PlacementReason.FREE


class TestTheEdges:
    def test_a_market_with_no_plan_reports_nothing(self):
        assert unplaced_dates(None, [vendor()], []) == []

    def test_a_market_with_no_dates_reports_nothing(self):
        assert unplaced_dates(plan(dates=[]), [vendor()], []) == []

    def test_an_address_is_matched_however_it_was_capitalized(self):
        setup = plan()
        placed = [placement("Nadia@Ember.Test", DATES[0], "Section Gold 1")]

        result = reasons(setup, [vendor(email="nadia@ember.test")], placed)

        assert (
            "nadia@ember.test",
            DATES[0],
        ) not in result, "a placement and a vendor are the same person whatever the case"

    def test_a_fully_placed_vendor_appears_nowhere(self):
        setup = plan()
        placed = [
            placement("nadia@ember.test", DATES[0], "Section Gold 1"),
            placement("nadia@ember.test", DATES[1], "Section Gold 1"),
        ]

        assert unplaced_dates(setup, [vendor()], placed) == []
