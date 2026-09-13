"""What the solver actually does, pinned before its input is swapped.

Written for E02/F01/S02. The solver had no behavioural tests of its own: ``assign_market`` is
monkeypatched away in the assignment-statistics tests, and the only module that really runs it
exists to test column mapping, which E02/F04 deletes. So there was nothing to prove the swap
from CSV rows to ``Application`` records preserved placement, and a diff that moves assignment
output with no witness to the old behaviour is unreviewable.

A scenario here is described once, in terms of what a vendor actually wants, and then fed to the
solver through whichever input path is under test. That is the point: the same scenario, the same
assertions, two inputs. Equivalence is then a property the tests can state rather than a claim
the commit message makes.
"""
import pytest

from assignment.assignment import assign_market
from datatypes import (
    AssignmentObject,
    AssignmentOptionObject,
    LocationObject,
    Market,
    MarketDateObject,
    MarketRole,
    SectionObject,
    SetupObject,
    TierObject,
)

DATES = ["2025-03-17", "2025-03-18"]
GOLD = "Gold"
SILVER = "Silver"


class VendorWant:
    """One vendor's ask, in the domain's terms rather than any input format's.

    ``available`` is which dates they can attend, ``tiers`` which tiers they accept anywhere -
    the split E02 makes explicit and the CSV encoding conflated into one answer per date.
    """

    def __init__(self, email, available, tiers, table_choice="Full table",
                 share_with="", max_days=None):
        self.email = email
        self.available = list(available)
        self.tiers = list(tiers)
        self.table_choice = table_choice
        self.share_with = share_with
        self.max_days = max_days


def market_for(wants, *, section_counts=((GOLD, 2), (SILVER, 2)), max_per_vendor=4,
               half_proportion=100):
    """A market plan plus the CSV source data describing ``wants``.

    The per-date cell is the tiers the vendor accepts on that date, which for these scenarios is
    their whole tier answer on every date they can attend and blank otherwise. That is exactly
    the mapping E02 makes structural: availability and tier are one answer here and two there.
    """
    tiers = {GOLD: TierObject(id=1, name=GOLD), SILVER: TierObject(id=2, name=SILVER)}
    location = LocationObject(name="Main Hall")
    sections = [
        SectionObject(name=f"Section {tier}", location=location, tier=tiers[tier], count=count)
        for tier, count in section_counts
    ]

    col_names = ["Email", "TableChoice", "ShareWith", "MaxDays"] + list(DATES)
    market_dates = [
        MarketDateObject(date=date, col_name_idx=4 + index)
        for index, date in enumerate(DATES)
    ]
    setup = SetupObject(
        col_names=col_names,
        col_values=[[] for _ in col_names],
        col_include=[True] * len(col_names),
        enum_priority_order=[[] for _ in col_names],
        priority=[],
        market_dates=market_dates,
        tiers=list(tiers.values()),
        locations=[location],
        sections=sections,
        assignment_options=AssignmentOptionObject(
            max_assignments_per_vendor=max_per_vendor,
            max_half_table_proportion_per_section=half_proportion,
            email_col_name_idx=0,
            table_choice_col_name_idx=1,
            table_share_email_col_name_idx=2,
            max_days_col_name_idx=3,
        ),
    )

    rows = [list(col_names)]
    for want in wants:
        row = [
            want.email,
            want.table_choice,
            want.share_with,
            "" if want.max_days is None else str(want.max_days),
        ]
        for date in DATES:
            row.append(",".join(want.tiers) if date in want.available else "")
        rows.append(row)

    market = Market(
        id="market-under-test",
        name="Test Market",
        creation_date="2025-01-01",
        roles={"organizer": MarketRole.OWNER},
        modification_list=[],
        assignment_object=AssignmentObject(),
        setup_object=setup,
    )
    return market, {"headers": list(col_names), "data": rows}


def placements(market):
    """Every placement as ``(email, date, table_code, table_choice, section, tier)``."""
    assignment = market.assignment_object
    return [
        (r.email, r.date, r.table_code, r.table_choice, r.section, r.tier)
        for r in (assignment.vendor_assignments or [])
    ]


def assign(wants, **kwargs):
    market, source_data = market_for(wants, **kwargs)
    return assign_market(market, source_data)


def dates_for(market, email):
    return sorted(p[1] for p in placements(market) if p[0] == email)


class TestAVendorOnlyGetsWhatTheyAskedFor:
    def test_a_vendor_is_never_placed_on_a_date_they_are_unavailable(self):
        market = assign([
            VendorWant("mon@example.com", available=[DATES[0]], tiers=[GOLD]),
            VendorWant("both@example.com", available=DATES, tiers=[GOLD]),
        ])

        assert dates_for(market, "mon@example.com") == [DATES[0]]

    def test_a_vendor_is_never_placed_at_a_tier_they_did_not_accept(self):
        market = assign([
            VendorWant("gold@example.com", available=DATES, tiers=[GOLD]),
            VendorWant("silver@example.com", available=DATES, tiers=[SILVER]),
        ])

        placed = placements(market)
        assert placed, "a vacuous pass would prove nothing here"
        for email, _, _, _, _, tier in placed:
            expected = GOLD if email == "gold@example.com" else SILVER
            assert tier == expected

    def test_a_vendor_accepting_both_tiers_may_be_placed_at_either(self):
        market = assign([
            VendorWant("either@example.com", available=DATES, tiers=[GOLD, SILVER]),
        ])

        assert placements(market)

    def test_a_vendor_is_placed_at_most_once_per_date(self):
        market = assign([
            VendorWant("greedy@example.com", available=DATES, tiers=[GOLD, SILVER]),
        ])

        dates = [p[1] for p in placements(market) if p[0] == "greedy@example.com"]
        assert len(dates) == len(set(dates))


class TestTheCapOnHowManyDates:
    def test_a_vendor_never_exceeds_the_dates_they_asked_for(self):
        market = assign([
            VendorWant("one@example.com", available=DATES, tiers=[GOLD], max_days=1),
        ])

        assert len(dates_for(market, "one@example.com")) == 1

    def test_a_vendor_who_named_no_cap_may_take_every_date_they_can(self):
        market = assign([
            VendorWant("all@example.com", available=DATES, tiers=[GOLD]),
        ])

        assert dates_for(market, "all@example.com") == sorted(DATES)


class TestHowATableIsOccupied:
    def test_a_full_table_vendor_holds_a_whole_table(self):
        market = assign([
            VendorWant("full@example.com", available=[DATES[0]], tiers=[GOLD],
                       table_choice="Full table"),
        ])

        assert placements(market)
        choices = {p[3] for p in placements(market)}
        assert choices == {"Full Table"}

    def test_two_half_table_vendors_share_one_table(self):
        market = assign([
            VendorWant("left@example.com", available=[DATES[0]], tiers=[GOLD],
                       table_choice="Half table"),
            VendorWant("right@example.com", available=[DATES[0]], tiers=[GOLD],
                       table_choice="Half table"),
        ])

        first_date = [p for p in placements(market) if p[1] == DATES[0]]
        codes = {p[2] for p in first_date}
        assert len(first_date) == 2
        assert len(codes) == 1, "both halves belong to one table"
        assert {p[3] for p in first_date} == {"Half Table (Left)", "Half Table (Right)"}

    def test_a_named_partner_is_seated_at_the_same_table(self):
        market = assign([
            VendorWant("asker@example.com", available=[DATES[0]], tiers=[GOLD],
                       table_choice="Half table", share_with="partner@example.com"),
            VendorWant("filler@example.com", available=[DATES[0]], tiers=[GOLD],
                       table_choice="Half table"),
            VendorWant("partner@example.com", available=[DATES[0]], tiers=[GOLD],
                       table_choice="Half table"),
        ])

        by_email = {p[0]: p[2] for p in placements(market) if p[1] == DATES[0]}
        assert by_email["asker@example.com"] == by_email["partner@example.com"]

    def test_no_table_holds_more_than_two_vendors(self):
        market = assign([
            VendorWant(f"v{i}@example.com", available=DATES, tiers=[GOLD, SILVER],
                       table_choice="Half table")
            for i in range(8)
        ])

        seats = {}
        assert placements(market)
        for email, date, code, _, _, _ in placements(market):
            seats.setdefault((date, code), []).append(email)
        assert all(len(occupants) <= 2 for occupants in seats.values())


class TestCapacity:
    def test_no_more_vendors_are_placed_than_there_are_tables(self):
        market = assign(
            [
                VendorWant(f"v{i}@example.com", available=[DATES[0]], tiers=[GOLD],
                           table_choice="Full table")
                for i in range(5)
            ],
            section_counts=((GOLD, 2),),
        )

        first_date = [p for p in placements(market) if p[1] == DATES[0]]
        assert len(first_date) == 2

    def test_a_vendor_who_accepts_no_offered_tier_is_left_unassigned(self):
        market = assign(
            [VendorWant("nobody@example.com", available=DATES, tiers=[SILVER])],
            section_counts=((GOLD, 2),),
        )

        assert placements(market) == []

    def test_every_placement_names_a_real_section_and_tier(self):
        market = assign([
            VendorWant("a@example.com", available=DATES, tiers=[GOLD, SILVER]),
            VendorWant("b@example.com", available=DATES, tiers=[GOLD, SILVER]),
        ])

        placed = placements(market)
        assert placed
        for _, _, _, _, section, tier in placed:
            assert section in {f"Section {GOLD}", f"Section {SILVER}"}
            assert tier in {GOLD, SILVER}


class TestTheStatisticsTheOrganizerSees:
    def test_an_unplaced_vendor_is_reported_as_unassigned(self):
        market = assign(
            [
                VendorWant("placed@example.com", available=[DATES[0]], tiers=[GOLD],
                           table_choice="Full table"),
                VendorWant("unplaced@example.com", available=[DATES[0]], tiers=[SILVER],
                           table_choice="Full table"),
            ],
            section_counts=((GOLD, 1),),
        )

        statistics = market.assignment_object.assignment_statistics
        assert "unplaced@example.com" in statistics.unassigned_vendors

    def test_the_statistics_count_the_placements_that_happened(self):
        market = assign([
            VendorWant("a@example.com", available=DATES, tiers=[GOLD]),
        ])

        statistics = market.assignment_object.assignment_statistics
        assert statistics.total_vendors == 1
