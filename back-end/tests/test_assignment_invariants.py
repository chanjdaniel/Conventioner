"""What a table allocation must hold, and the solver held to it (T253).

``allocation_breaches`` is pure, so each rule is tested here on a hand-built plan and hand-built
rows, with no solver run: after the double-seat fix no real market breaks a rule, and every rule
still needs a case that breaks it.
"""
import pytest

from assignment.invariants import (
    DATE_NOT_RUN,
    DAY_THEY_CANNOT_COME,
    HALF_FOR_WHOLE_TABLE,
    HAND_PLACED_BY_NOBODY,
    OUTSIDE_THE_RUN,
    OVER_THEIR_LIMIT,
    PIN_NOT_KEPT,
    SEAT_NOT_ON_TABLE,
    SEAT_TAKEN_TWICE,
    TABLE_MISDESCRIBED,
    TABLE_NOT_IN_PLAN,
    TIER_NOT_CHOSEN,
    TWO_ON_ONE_DAY,
    Breach,
    BrokenAllocationError,
    allocation_breaches,
    require_sound_allocation,
)
from assignment.vendor_input import SolverVendor
from datatypes import (
    AssignmentOptionObject,
    LocationObject,
    MarketDateObject,
    SectionObject,
    SetupObject,
    TierObject,
    VendorAssignmentResult,
)

DATE = "2026-08-01"
OTHER_DATE = "2026-08-02"
FULL = "Full Table"
LEFT = "Half Table (Left)"
RIGHT = "Half Table (Right)"

# What the plan says of each of its tables' sections: Hall A is Gold in the Main Hall, the Garden
# has neither a tier nor a location, which the solver writes as "".
DESCRIBED = {"Hall A": ("Hall A", "Gold", "Main Hall"), "Garden": ("Garden", "", "")}


def plan(ceiling=None) -> SetupObject:
    """Two dates; Hall A 1 and 2 (Gold, Main Hall), and Garden 1, with no tier or location."""
    gold = TierObject(id=1, name="Gold")
    hall = LocationObject(name="Main Hall")
    return SetupObject(
        priority=[],
        market_dates=[MarketDateObject(date=DATE), MarketDateObject(date=OTHER_DATE)],
        tiers=[gold, TierObject(id=2, name="Silver")],
        locations=[hall],
        sections=[
            SectionObject(name="Hall A", location=hall, tier=gold, count=2),
            SectionObject(name="Garden", count=1),
        ],
        assignment_options=AssignmentOptionObject(max_assignments_per_vendor=ceiling),
    )


def vendor(name, **overrides) -> SolverVendor:
    """``app-<name>`` at ``<name>@example.com``: both dates, Gold on each, either table, no limit."""
    fields = dict(
        application_id=f"app-{name}",
        email=f"{name}@example.com",
        available_dates=frozenset({DATE, OTHER_DATE}),
        max_dates=None,
        accepted_tiers_by_date={DATE: frozenset({"Gold"}), OTHER_DATE: frozenset({"Gold"})},
        table_choice="either",
        table_share_email=None,
        section_ranking=(),
        table_type_ranking=(),
    )
    fields.update(overrides)
    return SolverVendor(**fields)


def row(name, table_code="Hall A 1", table_choice=FULL, date=DATE, **overrides):
    """One assignment of ``<name>@example.com``, describing its table as the plan does."""
    section, tier, location = DESCRIBED[table_code.rsplit(" ", 1)[0]]
    fields = dict(
        email=f"{name}@example.com",
        date=date,
        table_code=table_code,
        table_choice=table_choice,
        section=section,
        tier=tier,
        location=location,
    )
    fields.update(overrides)
    return VendorAssignmentResult(**fields)


def pin(name, table_code="Hall A 1", table_choice=FULL, date=DATE, **overrides):
    return row(name, table_code, table_choice, date, hand_placed=True, **overrides)


def breaches(assignments, vendors=(), pins=(), orphaned_pins=(), setup=None):
    return allocation_breaches(
        setup or plan(), list(vendors), list(pins), list(orphaned_pins), list(assignments)
    )


class TestTheCheck:
    def test_a_sound_allocation_has_no_breaches(self):
        held = pin("dan", "Garden 1")
        assert breaches(
            [row("ana"), row("ben", "Hall A 2", LEFT), row("cal", "Hall A 2", RIGHT), held],
            vendors=[vendor("ana"), vendor("ben"), vendor("cal"), vendor("dan")],
            pins=[held],
        ) == []

    def test_a_pin_the_allocation_left_out_was_not_kept(self):
        assert breaches([], vendors=[vendor("ana")], pins=[pin("ana")]) == [
            Breach(PIN_NOT_KEPT, DATE, "Hall A 1", ("app-ana",))
        ]

    def test_a_pin_changed_by_the_run_was_not_kept(self):
        moved = pin("ana", "Hall A 2")
        assert breaches([moved], vendors=[vendor("ana")], pins=[pin("ana")]) == [
            Breach(PIN_NOT_KEPT, DATE, "Hall A 1", ("app-ana",)),
            Breach(HAND_PLACED_BY_NOBODY, DATE, "Hall A 2", ("app-ana",)),
        ]

    def test_the_solver_never_marks_its_own_row_hand_placed(self):
        assert breaches([pin("ana")], vendors=[vendor("ana")]) == [
            Breach(HAND_PLACED_BY_NOBODY, DATE, "Hall A 1", ("app-ana",))
        ]

    def test_a_solver_row_for_someone_outside_the_run_names_no_address(self):
        assert breaches([row("stranger")], vendors=[vendor("ana")]) == [
            Breach(OUTSIDE_THE_RUN, DATE, "Hall A 1", ("outside the run",))
        ]

    def test_a_held_vendor_holds_pins_only(self):
        held = pin("held")
        assert breaches(
            [held, row("held", "Hall A 2", date=OTHER_DATE)], vendors=[vendor("ana")], pins=[held]
        ) == [Breach(OUTSIDE_THE_RUN, OTHER_DATE, "Hall A 2", ("outside the run",))]

    def test_a_date_the_market_does_not_run(self):
        elsewhere = "2026-09-01"
        ana = vendor(
            "ana",
            available_dates=frozenset({DATE, elsewhere}),
            accepted_tiers_by_date={DATE: frozenset({"Gold"}), elsewhere: frozenset({"Gold"})},
        )
        assert breaches([row("ana", date=elsewhere)], vendors=[ana]) == [
            Breach(DATE_NOT_RUN, elsewhere, "Hall A 1", ("app-ana",))
        ]

    def test_a_table_the_plan_does_not_have(self):
        assert breaches([row("ana", "Hall A 3")], vendors=[vendor("ana")]) == [
            Breach(TABLE_NOT_IN_PLAN, DATE, "Hall A 3", ("app-ana",))
        ]

    @pytest.mark.parametrize("field, wrong", [
        ("section", "Hall B"), ("tier", "Silver"), ("location", "Annex"),
    ])
    def test_an_assignment_that_misdescribes_its_table(self, field, wrong):
        assert breaches([row("ana", **{field: wrong})], vendors=[vendor("ana")]) == [
            Breach(TABLE_MISDESCRIBED, DATE, "Hall A 1", ("app-ana",))
        ]

    def test_an_untiered_table_is_described_with_no_tier_and_no_location(self):
        assert breaches([row("ana", "Garden 1")], vendors=[vendor("ana")]) == []
        assert breaches([row("ana", "Garden 1", tier="Gold")], vendors=[vendor("ana")]) == [
            Breach(TABLE_MISDESCRIBED, DATE, "Garden 1", ("app-ana",))
        ]

    def test_a_seat_the_table_does_not_have(self):
        assert breaches([row("ana", table_choice="Half Table")], vendors=[vendor("ana")]) == [
            Breach(SEAT_NOT_ON_TABLE, DATE, "Hall A 1", ("app-ana",))
        ]

    def test_a_day_they_cannot_come(self):
        ana = vendor("ana", available_dates=frozenset({OTHER_DATE}))
        assert breaches([row("ana")], vendors=[ana]) == [
            Breach(DAY_THEY_CANNOT_COME, DATE, "Hall A 1", ("app-ana",))
        ]

    def test_a_tier_they_did_not_choose_that_day(self):
        ana = vendor(
            "ana",
            accepted_tiers_by_date={DATE: frozenset({"Silver"}), OTHER_DATE: frozenset({"Gold"})},
        )
        assert breaches([row("ana")], vendors=[ana]) == [
            Breach(TIER_NOT_CHOSEN, DATE, "Hall A 1", ("app-ana",))
        ]
        assert breaches([row("ana", date=OTHER_DATE)], vendors=[ana]) == []

    def test_an_untiered_table_takes_any_tier(self):
        ana = vendor("ana", accepted_tiers_by_date={DATE: frozenset({"Silver"})})
        assert breaches([row("ana", "Garden 1")], vendors=[ana]) == []

    def test_a_half_for_a_vendor_who_asked_for_a_whole_table(self):
        assert breaches([row("ana", table_choice=LEFT)], vendors=[vendor("ana", table_choice="full")]) == [
            Breach(HALF_FOR_WHOLE_TABLE, DATE, "Hall A 1", ("app-ana",))
        ]

    def test_two_assignments_for_one_vendor_on_one_day(self):
        assert breaches([row("ana"), row("ana", "Hall A 2")], vendors=[vendor("ana")]) == [
            Breach(TWO_ON_ONE_DAY, DATE, None, ("app-ana",))
        ]

    def test_a_solver_row_on_a_day_a_pin_already_holds_is_two_assignments(self):
        held = pin("ana")
        assert breaches([held, row("ana", "Hall A 2")], vendors=[vendor("ana")], pins=[held]) == [
            Breach(TWO_ON_ONE_DAY, DATE, None, ("app-ana",))
        ]

    @pytest.mark.parametrize("ceiling, own_limit", [(1, None), (None, 1), (2, 1), (1, 2)])
    def test_more_days_than_their_limit(self, ceiling, own_limit):
        assert breaches(
            [row("ana"), row("ana", date=OTHER_DATE)],
            vendors=[vendor("ana", max_dates=own_limit)],
            setup=plan(ceiling=ceiling),
        ) == [Breach(OVER_THEIR_LIMIT, None, None, ("app-ana",))]

    def test_a_pin_counts_towards_the_limit(self):
        held = pin("ana")
        assert breaches(
            [held, row("ana", date=OTHER_DATE)],
            vendors=[vendor("ana", max_dates=1)],
            pins=[held],
        ) == [Breach(OVER_THEIR_LIMIT, None, None, ("app-ana",))]

    def test_pins_alone_over_the_limit_are_the_organizers_decision(self):
        pins = [pin("ana"), pin("ana", date=OTHER_DATE)]
        assert breaches(pins, vendors=[vendor("ana", max_dates=1)], pins=pins) == []

    def test_a_seat_taken_twice(self):
        assert breaches([row("ana"), row("ben")], vendors=[vendor("ana"), vendor("ben")]) == [
            Breach(SEAT_TAKEN_TWICE, DATE, "Hall A 1", ("app-ana", "app-ben"))
        ]

    def test_a_half_beside_a_whole_table_is_a_seat_taken_twice(self):
        assert breaches(
            [row("ana"), row("ben", table_choice=RIGHT)], vendors=[vendor("ana"), vendor("ben")]
        ) == [Breach(SEAT_TAKEN_TWICE, DATE, "Hall A 1", ("app-ana", "app-ben"))]

    def test_a_solver_row_on_a_pinned_seat_is_a_seat_taken_twice(self):
        held = pin("ana", table_choice=LEFT)
        assert breaches(
            [held, row("ben", table_choice=LEFT)], vendors=[vendor("ana"), vendor("ben")],
            pins=[held],
        ) == [Breach(SEAT_TAKEN_TWICE, DATE, "Hall A 1", ("app-ana", "app-ben"))]

    def test_the_same_seat_on_another_date_is_another_seat(self):
        assert breaches(
            [row("ana"), row("ben", date=OTHER_DATE)], vendors=[vendor("ana"), vendor("ben")]
        ) == []

    def test_two_pins_on_one_seat_are_the_organizers_to_settle(self):
        pins = [pin("ana"), pin("ben", table_choice=RIGHT)]
        assert breaches(pins, vendors=[vendor("ana"), vendor("ben")], pins=pins) == []

    def test_a_pin_against_its_vendors_answers_stands(self):
        ana = vendor(
            "ana",
            available_dates=frozenset({OTHER_DATE}),
            accepted_tiers_by_date={OTHER_DATE: frozenset({"Silver"})},
            table_choice="full",
        )
        held = pin("ana", table_choice=LEFT)
        assert breaches([held], vendors=[ana], pins=[held]) == []

    def test_an_orphaned_pin_holds_no_seat(self):
        orphan = pin("ana")
        assert breaches(
            [orphan, row("ben")], vendors=[vendor("ana"), vendor("ben")],
            pins=[orphan], orphaned_pins=[orphan],
        ) == []

    def test_breaches_come_in_rule_order_then_date_then_table(self):
        assert breaches(
            [row("ana"), row("ben"), row("cal", "Hall A 3", date=OTHER_DATE),
             row("dan", "Hall A 4")],
            vendors=[vendor("ana"), vendor("ben"), vendor("cal"), vendor("dan")],
        ) == [
            Breach(TABLE_NOT_IN_PLAN, DATE, "Hall A 4", ("app-dan",)),
            Breach(TABLE_NOT_IN_PLAN, OTHER_DATE, "Hall A 3", ("app-cal",)),
            Breach(SEAT_TAKEN_TWICE, DATE, "Hall A 1", ("app-ana", "app-ben")),
        ]


class TestTheRefusal:
    def test_a_sound_allocation_passes(self):
        require_sound_allocation(plan(), [vendor("ana")], [], [], [row("ana")])

    def test_the_message_names_the_rule_the_table_the_date_and_the_applications(self):
        with pytest.raises(BrokenAllocationError) as refused:
            require_sound_allocation(
                plan(), [vendor("ana"), vendor("ben")], [], [],
                [row("ana"), row("ben"), row("ana", date=OTHER_DATE), row("stranger", "Garden 1")],
            )

        assert str(refused.value) == (
            "The table allocation breaks the solver's rules, so it was not kept: "
            "an assignment for someone outside the run at Garden 1 on 2026-08-01 (outside the run); "
            "a seat taken twice at Hall A 1 on 2026-08-01 (app-ana, app-ben)"
        )
        assert [breach.rule for breach in refused.value.breaches] == [
            OUTSIDE_THE_RUN, SEAT_TAKEN_TWICE,
        ]
        assert "@" not in str(refused.value)

    def test_a_breach_about_a_vendor_names_no_table_and_no_date(self):
        with pytest.raises(BrokenAllocationError) as refused:
            require_sound_allocation(
                plan(ceiling=1), [vendor("ana")], [], [],
                [row("ana"), row("ana", date=OTHER_DATE)],
            )

        assert str(refused.value).endswith(": more days than their limit (app-ana)")

    def test_the_message_spells_out_ten_breaches_and_counts_the_rest(self):
        names = [f"v{n:02}" for n in range(12)]
        with pytest.raises(BrokenAllocationError) as refused:
            require_sound_allocation(
                plan(), [vendor(name) for name in names], [], [],
                [row(name, f"Hall A {n + 3}") for n, name in enumerate(names)],
            )

        message = str(refused.value)
        assert len(refused.value.breaches) == 12
        assert message.count(TABLE_NOT_IN_PLAN) == 10
        assert message.endswith("(app-v09); and 2 more")

    def test_it_is_a_builtin_no_except_value_error_catches(self):
        assert issubclass(BrokenAllocationError, RuntimeError)
        assert not issubclass(BrokenAllocationError, ValueError)
