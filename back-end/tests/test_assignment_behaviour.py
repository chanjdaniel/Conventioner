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

from assignment.assignment import assign_market, describe_stored_assignment
from assignment.vendor_input import SolverVendor
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
    VendorAssignmentResult,
)

DATES = ["2025-03-17", "2025-03-18"]
GOLD = "Gold"
SILVER = "Silver"


class VendorWant:
    """One vendor's ask, in the domain's terms rather than any input format's.

    ``available`` is which dates they can attend and ``tiers`` which tiers they accept - the
    split E02 makes explicit and the CSV encoding conflated into one answer per date.

    ``tiers`` may be a flat list, meaning the same tiers on every available date (the common case),
    or a ``{date: [tier]}`` mapping when a test is about tiers differing per day (E01/F05).
    """

    def __init__(self, email, available, tiers, table_choice="full",
                 share_with="", max_days=None, sections=()):
        self.email = email
        self.available = list(available)
        self.tiers = tiers
        self.table_choice = table_choice
        self.share_with = share_with
        self.max_days = max_days
        self.sections = tuple(sections)

    def tiers_by_date(self):
        """Tier is answered per date. A flat list means the same answer on every available date."""
        if isinstance(self.tiers, dict):
            return {date: frozenset(names) for date, names in self.tiers.items()}
        return {date: frozenset(self.tiers) for date in self.available}

    def as_solver_vendor(self):
        return SolverVendor(
            application_id=f"app-{self.email}",
            email=self.email,
            available_dates=frozenset(self.available),
            max_dates=self.max_days,
            accepted_tiers_by_date=self.tiers_by_date(),
            table_choice=self.table_choice,
            table_share_email=self.share_with or None,
            section_ranking=self.sections,
            table_type_ranking=(),
        )


def market_for(wants, *, section_counts=((GOLD, 2), (SILVER, 2)), max_per_vendor=4,
               half_proportion=100, dates=None):
    """A market plan for ``wants``. The plan no longer describes any spreadsheet."""
    dates = list(dates or DATES)
    tiers = {GOLD: TierObject(id=1, name=GOLD), SILVER: TierObject(id=2, name=SILVER)}
    location = LocationObject(name="Main Hall")
    sections = [
        SectionObject(name=f"Section {tier}", location=location, tier=tiers[tier], count=count)
        for tier, count in section_counts
    ]
    setup = SetupObject(
        priority=[],
        market_dates=[MarketDateObject(date=date) for date in dates],
        tiers=list(tiers.values()),
        locations=[location],
        sections=sections,
        assignment_options=AssignmentOptionObject(
            max_assignments_per_vendor=max_per_vendor,
            max_half_table_proportion_per_section=half_proportion,
        ),
    )
    return Market(
        id="market-under-test",
        name="Test Market",
        creation_date="2025-01-01",
        roles={"organizer": MarketRole.OWNER},
        modification_list=[],
        assignment_object=AssignmentObject(),
        setup_object=setup,
    )


def placements(market):
    """Every placement as ``(email, date, table_code, table_choice, section, tier)``."""
    assignment = market.assignment_object
    return [
        (r.email, r.date, r.table_code, r.table_choice, r.section, r.tier)
        for r in (assignment.vendor_assignments or [])
    ]


def assign(wants, pins=(), **kwargs):
    market = market_for(wants, **kwargs)
    market.assignment_object = AssignmentObject(vendor_assignments=list(pins))
    return assign_market(market, [want.as_solver_vendor() for want in wants])


def pin(email, date, table_code, table_choice="Full Table",
        section=f"Section {GOLD}", tier=GOLD):
    """A hand-placed row on the market's stored assignment - which is all a pin is."""
    return VendorAssignmentResult(
        email=email,
        date=date,
        table_code=table_code,
        table_choice=table_choice,
        section=section,
        tier=tier,
        location="Main Hall",
        hand_placed=True,
    )


def seat_of(market, email, date):
    """Where one vendor sits on one date, as ``(table_code, table_choice)``, or None."""
    for placement in market.assignment_object.vendor_assignments or []:
        if placement.email == email and placement.date == date:
            return (placement.table_code, placement.table_choice)
    return None


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
                       table_choice="full"),
        ])

        assert placements(market)
        choices = {p[3] for p in placements(market)}
        assert choices == {"Full Table"}

    def test_two_half_table_vendors_share_one_table(self):
        market = assign([
            VendorWant("left@example.com", available=[DATES[0]], tiers=[GOLD],
                       table_choice="half"),
            VendorWant("right@example.com", available=[DATES[0]], tiers=[GOLD],
                       table_choice="half"),
        ])

        first_date = [p for p in placements(market) if p[1] == DATES[0]]
        codes = {p[2] for p in first_date}
        assert len(first_date) == 2
        assert len(codes) == 1, "both halves belong to one table"
        assert {p[3] for p in first_date} == {"Half Table (Left)", "Half Table (Right)"}

    def test_a_named_partner_is_seated_at_the_same_table(self):
        market = assign([
            VendorWant("asker@example.com", available=[DATES[0]], tiers=[GOLD],
                       table_choice="half", share_with="partner@example.com"),
            VendorWant("filler@example.com", available=[DATES[0]], tiers=[GOLD],
                       table_choice="half"),
            VendorWant("partner@example.com", available=[DATES[0]], tiers=[GOLD],
                       table_choice="half"),
        ])

        by_email = {p[0]: p[2] for p in placements(market) if p[1] == DATES[0]}
        assert by_email["asker@example.com"] == by_email["partner@example.com"]

    def test_no_table_holds_more_than_two_vendors(self):
        market = assign([
            VendorWant(f"v{i}@example.com", available=DATES, tiers=[GOLD, SILVER],
                       table_choice="half")
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
                           table_choice="full")
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
                           table_choice="full"),
                VendorWant("unplaced@example.com", available=[DATES[0]], tiers=[SILVER],
                           table_choice="full"),
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

    def test_a_tier_that_took_nobody_is_reported_at_zero(self):
        """The row that explains a failed run was the row that was missing.

        "Silver: 0" says the run placed nobody who wanted Silver; no Silver row at all says
        nothing, and the organizer cannot tell it from a market with no Silver in it.
        """
        market = assign([VendorWant("a@example.com", available=[DATES[0]], tiers=[GOLD])])

        statistics = market.assignment_object.assignment_statistics
        assert statistics.assignments_per_tier[SILVER] == 0
        assert statistics.assignments_per_tier[GOLD] == 1

    def test_a_section_that_took_nobody_is_reported_at_zero(self):
        market = assign([VendorWant("a@example.com", available=[DATES[0]], tiers=[GOLD])])

        statistics = market.assignment_object.assignment_statistics
        assert statistics.assignments_per_section[f"Section {SILVER}"] == 0

    def test_a_date_that_took_nobody_is_reported_at_zero(self):
        market = assign([VendorWant("a@example.com", available=[DATES[0]], tiers=[GOLD])])

        statistics = market.assignment_object.assignment_statistics
        assert statistics.assignments_per_date[DATES[1]] == 0

    def test_the_counts_are_of_the_plan_not_of_what_landed(self):
        """Every tier and section the plan declares appears, whatever the run did."""
        market = assign([VendorWant("a@example.com", available=[DATES[0]], tiers=[GOLD])])

        statistics = market.assignment_object.assignment_statistics
        assert set(statistics.assignments_per_tier) == {GOLD, SILVER}
        assert set(statistics.assignments_per_section) == {f"Section {GOLD}", f"Section {SILVER}"}


class TestTheSatisfactionScore:
    """How much of what the vendors asked for they got.

    It used to be 0.0 when there was nobody to score, so an empty run reported "0.0%" - which
    reads as a run that satisfied nobody rather than a run with nothing to satisfy.
    """

    def test_a_vendor_who_got_everything_they_asked_for_scores_one(self):
        market = assign([VendorWant("a@example.com", available=[DATES[0]], tiers=[GOLD])])

        assert market.assignment_object.assignment_statistics.satisfaction_score == 1.0

    def test_a_vendor_who_got_half_of_what_they_asked_for_scores_a_half(self):
        market = assign(
            [
                VendorWant("a@example.com", available=DATES, tiers=[GOLD]),
                VendorWant("b@example.com", available=[DATES[0]], tiers=[GOLD]),
                VendorWant("c@example.com", available=[DATES[0]], tiers=[GOLD]),
            ],
            section_counts=((GOLD, 1),),
        )

        # One Gold table per date. On DATES[0] one of the three is placed; on DATES[1] only "a"
        # is available, so "a" takes it.
        assert 0 < market.assignment_object.assignment_statistics.satisfaction_score < 1

    def test_a_run_with_no_vendors_has_no_score_rather_than_a_score_of_zero(self):
        market = assign([])

        assert market.assignment_object.assignment_statistics.satisfaction_score is None

    def test_a_vendor_who_could_attend_no_date_is_left_out_of_the_average(self):
        """They asked for nothing this market could give, so the solver neither satisfied nor
        failed them. Counting them as a zero understated every real run they appeared in."""
        market = assign([
            VendorWant("placed@example.com", available=[DATES[0]], tiers=[GOLD]),
            VendorWant("elsewhere@example.com", available=["2099-01-01"], tiers=[GOLD]),
        ])

        assert market.assignment_object.assignment_statistics.satisfaction_score == 1.0

    def test_a_run_where_nobody_could_be_scored_has_no_score(self):
        market = assign([VendorWant("elsewhere@example.com", available=["2099-01-01"], tiers=[GOLD])])

        assert market.assignment_object.assignment_statistics.satisfaction_score is None


class TestAssigningFromTheMarketsOwnApplications:
    """The end of the facade: a market reaches assignment through its applications.

    Nothing fetches a spreadsheet first, which is what makes an application-intake market
    assignable at all.
    """

    def _approve(self, applications, market, wants):
        import essential_fields as EF
        from datatypes import Application, ApplicationStatus

        for want in wants:
            application = Application(
                id=f"app-{want.email}",
                market_id=market.id,
                applicant_email=want.email,
                status=ApplicationStatus.REVIEWER_APPROVED,
                form_data={
                    EF.AVAILABLE_DATES_KEY: want.available,
                    EF.MAX_DATES_KEY: want.max_days or len(DATES),
                    # Stored per date (E01/F05); a flat `tiers` means the same answer every day.
                    EF.TIER_PREFERENCE_KEY: {d: list(t) for d, t in want.tiers_by_date().items()},
                    EF.TABLE_CHOICE_KEY: want.table_choice,
                    EF.TABLE_SHARE_EMAIL_KEY: want.share_with,
                    EF.SECTION_RANKING_KEY: [
                        section.name for section in market.setup_object.sections
                    ],
                    EF.TABLE_TYPE_RANKING_KEY: [],
                },
            )
            applications.documents.append(application.model_dump(mode="json"))

    def test_a_market_is_assigned_from_its_approved_applications(self, applications):
        market = market_for([])
        wants = [
            VendorWant("a@example.com", available=DATES, tiers=[GOLD]),
            VendorWant("b@example.com", available=[DATES[0]], tiers=[GOLD]),
        ]
        self._approve(applications, market, wants)

        assigned = assign_market(market)

        assert {p[0] for p in placements(assigned)} == {"a@example.com", "b@example.com"}

    def test_an_application_awaiting_review_is_not_assigned(self, applications):
        from datatypes import ApplicationStatus

        market = market_for([])
        self._approve(
            applications, market,
            [VendorWant("pending@example.com", available=DATES, tiers=[GOLD])],
        )
        applications.documents[0]["status"] = ApplicationStatus.OPEN.value

        assigned = assign_market(market)

        assert placements(assigned) == []

    def test_a_placement_is_dated_by_the_market_date_itself(self, applications):
        market = market_for([])
        self._approve(
            applications, market,
            [VendorWant("a@example.com", available=[DATES[0]], tiers=[GOLD])],
        )

        assigned = assign_market(market)

        assert {p[1] for p in placements(assigned)} == {DATES[0]}


class TestNoVendorIsStrandedBehindATableTheyCouldNotTake:
    """The defect the loop inversion fixes.

    The table-driven loop broke out the moment one table could not be filled, but validity is
    answered per table: a vendor who accepts only Silver is not valid for a Gold table. An
    unfillable table early in the list therefore ended the date and left every later table empty,
    stranding everyone whose tier sorted second.

    Pinned as a known defect by E02/F01/S02 so the input swap's diff stayed free of placement
    changes. Fixed here.
    """

    def test_a_vendor_is_placed_at_a_table_further_down_the_list(self):
        market = assign([
            VendorWant("gold@example.com", available=[DATES[0]], tiers=[GOLD]),
            VendorWant("silver@example.com", available=[DATES[0]], tiers=[SILVER]),
        ])

        placed = {p[0] for p in placements(market)}
        assert placed == {"gold@example.com", "silver@example.com"}

    def test_a_whole_tier_of_vendors_is_not_lost_to_one_unfillable_table(self):
        market = assign(
            [
                VendorWant(f"silver{i}@example.com", available=[DATES[0]], tiers=[SILVER])
                for i in range(2)
            ]
            + [VendorWant("gold@example.com", available=[DATES[0]], tiers=[GOLD])],
        )

        assert len({p[0] for p in placements(market)}) == 3


class TestAnIncompleteApplicationStopsTheRun:
    """Refusing the whole run is the design, not a limitation.

    Skipping the offending vendors would hand back an assignment that looks complete with
    someone silently missing from it, and nobody would have any reason to look.
    """

    def _store_incomplete(self, applications, market, email):
        import essential_fields as EF
        from datatypes import Application, ApplicationStatus

        applications.documents.append(
            Application(
                id=f"app-{email}",
                market_id=market.id,
                applicant_email=email,
                status=ApplicationStatus.REVIEWER_APPROVED,
                form_data={
                    EF.AVAILABLE_DATES_KEY: [],
                    EF.MAX_DATES_KEY: None,
                    EF.TIER_PREFERENCE_KEY: {date: [GOLD] for date in DATES},
                    EF.TABLE_CHOICE_KEY: "full",
                    EF.TABLE_SHARE_EMAIL_KEY: "",
                    EF.SECTION_RANKING_KEY: [],
                    EF.TABLE_TYPE_RANKING_KEY: [],
                },
            ).model_dump(mode="json")
        )

    def test_assignment_is_refused_rather_than_run_without_them(self, applications):
        from assignment.assignment import IncompleteApplicationsError

        market = market_for([])
        self._store_incomplete(applications, market, "broken@example.com")

        with pytest.raises(IncompleteApplicationsError):
            assign_market(market)

    def test_the_refusal_names_the_applicant(self, applications):
        from assignment.assignment import IncompleteApplicationsError

        market = market_for([])
        self._store_incomplete(applications, market, "broken@example.com")

        with pytest.raises(IncompleteApplicationsError) as raised:
            assign_market(market)

        assert "broken@example.com" in str(raised.value)

    def test_no_partial_assignment_is_produced(self, applications):
        from assignment.assignment import IncompleteApplicationsError

        market = market_for([])
        TestAssigningFromTheMarketsOwnApplications()._approve(
            applications, market,
            [VendorWant("fine@example.com", available=DATES, tiers=[GOLD])],
        )
        self._store_incomplete(applications, market, "broken@example.com")

        with pytest.raises(IncompleteApplicationsError):
            assign_market(market)
        assert market.assignment_object.vendor_assignments in ([], None)


MANY_DATES = [f"2025-04-{day:02d}" for day in range(1, 7)]


class TestTheOrganizersCapOnAssignmentsPerVendor:
    """The setting existed, was rendered, was clamped, was persisted - and was never read.

    An organizer could set it to six, watch it save, and get four, because a hard-coded
    four-day constant won everywhere. This is not new configuration; it is connecting a control
    that was lying.
    """

    def test_a_vendor_may_take_more_than_four_dates_when_the_organizer_allows_it(self):
        market = assign(
            [VendorWant("keen@example.com", available=MANY_DATES, tiers=[GOLD], max_days=6)],
            dates=MANY_DATES,
            max_per_vendor=6,
        )

        assert len(dates_for(market, "keen@example.com")) == 6

    def test_the_market_cap_bounds_a_vendor_who_asked_for_more(self):
        market = assign(
            [VendorWant("keen@example.com", available=MANY_DATES, tiers=[GOLD], max_days=6)],
            dates=MANY_DATES,
            max_per_vendor=2,
        )

        assert len(dates_for(market, "keen@example.com")) == 2

    def test_the_vendors_own_answer_bounds_them_below_the_market_cap(self):
        market = assign(
            [VendorWant("modest@example.com", available=MANY_DATES, tiers=[GOLD], max_days=1)],
            dates=MANY_DATES,
            max_per_vendor=6,
        )

        assert len(dates_for(market, "modest@example.com")) == 1

    def test_the_lower_of_the_two_wins_whichever_it_is(self):
        market = assign(
            [
                VendorWant("capped@example.com", available=MANY_DATES, tiers=[GOLD],
                           max_days=5),
                VendorWant("modest@example.com", available=MANY_DATES, tiers=[GOLD],
                           max_days=2),
            ],
            dates=MANY_DATES,
            max_per_vendor=3,
        )

        assert len(dates_for(market, "capped@example.com")) == 3
        assert len(dates_for(market, "modest@example.com")) == 2

    def test_an_unset_cap_leaves_the_vendors_own_answer_to_bound_them(self):
        """Documented, not accidental: no setting means the organizer set no ceiling."""
        market = assign(
            [VendorWant("keen@example.com", available=MANY_DATES, tiers=[GOLD], max_days=6)],
            dates=MANY_DATES,
            max_per_vendor=None,
        )

        assert len(dates_for(market, "keen@example.com")) == 6

    def test_a_vendor_wanting_twelve_dates_is_not_capped_at_one(self):
        """The CSV era read one character of the answer, so twelve became one."""
        market = assign(
            [VendorWant("twelve@example.com", available=MANY_DATES, tiers=[GOLD], max_days=12)],
            dates=MANY_DATES,
            max_per_vendor=6,
        )

        assert len(dates_for(market, "twelve@example.com")) == 6


class TestTheOrganizersPriorityRules:
    """A rule an organizer configures actually changes who is placed first.

    The old scheme scored on one case only: an enumerated ordering looked up by column index.
    Anything else - a rule marked as a number, ascending - scored every vendor identically and
    did nothing, with no error and no warning. These tests would fail under that behaviour.
    """

    def _one_table_market(self, wants, rules):
        from datatypes import PriorityObject

        market = market_for(wants, section_counts=((GOLD, 1),), dates=[DATES[0]])
        market.setup_object.priority = [
            PriorityObject(id=index, target=target, ordering=ordering)
            for index, (target, ordering) in enumerate(rules)
        ]
        return market

    def _assign_with(self, wants, rules, answers):
        market = self._one_table_market(wants, rules)
        vendors = []
        for want in wants:
            vendor = want.as_solver_vendor()
            vendors.append(
                type(vendor)(
                    **{
                        **vendor.__dict__,
                        "custom_answers": answers[want.email],
                    }
                )
            )
        return assign_market(market, vendors)

    def _contenders(self):
        return [
            VendorWant("returning@example.com", available=[DATES[0]], tiers=[GOLD]),
            VendorWant("newcomer@example.com", available=[DATES[0]], tiers=[GOLD]),
        ]

    def test_the_higher_ranked_answer_takes_the_only_table(self):
        market = self._assign_with(
            self._contenders(),
            [("returning_vendor", ["yes", "no"])],
            {
                "returning@example.com": {"returning_vendor": "yes"},
                "newcomer@example.com": {"returning_vendor": "no"},
            },
        )

        assert [p[0] for p in placements(market)] == ["returning@example.com"]

    def test_reversing_the_ordering_reverses_who_is_placed(self):
        """The sharpest proof the rule is read: only the ordering differs between the two runs."""
        market = self._assign_with(
            self._contenders(),
            [("returning_vendor", ["no", "yes"])],
            {
                "returning@example.com": {"returning_vendor": "yes"},
                "newcomer@example.com": {"returning_vendor": "no"},
            },
        )

        assert [p[0] for p in placements(market)] == ["newcomer@example.com"]

    def test_an_answer_the_organizer_did_not_place_falls_to_all_others(self):
        market = self._assign_with(
            self._contenders(),
            [("category", ["Food", "<All others>", "Vintage"])],
            {
                "returning@example.com": {"category": "Ceramics"},
                "newcomer@example.com": {"category": "Vintage"},
            },
        )

        assert [p[0] for p in placements(market)] == ["returning@example.com"]

    def test_an_unplaced_answer_sorts_last_when_there_is_no_all_others_token(self):
        market = self._assign_with(
            self._contenders(),
            [("category", ["Food", "Vintage"])],
            {
                "returning@example.com": {"category": "Ceramics"},
                "newcomer@example.com": {"category": "Vintage"},
            },
        )

        assert [p[0] for p in placements(market)] == ["newcomer@example.com"]

    def test_a_later_rule_only_breaks_a_tie_the_earlier_one_left(self):
        market = self._assign_with(
            self._contenders(),
            [("returning_vendor", ["yes", "no"]), ("category", ["Food", "Vintage"])],
            {
                "returning@example.com": {"returning_vendor": "yes", "category": "Vintage"},
                "newcomer@example.com": {"returning_vendor": "no", "category": "Food"},
            },
        )

        assert [p[0] for p in placements(market)] == ["returning@example.com"], (
            "the first rule decides; the second must not overturn it"
        )

    def test_a_tie_on_the_first_rule_is_broken_by_the_second(self):
        market = self._assign_with(
            self._contenders(),
            [("returning_vendor", ["yes", "no"]), ("category", ["Food", "Vintage"])],
            {
                "returning@example.com": {"returning_vendor": "yes", "category": "Vintage"},
                "newcomer@example.com": {"returning_vendor": "yes", "category": "Food"},
            },
        )

        assert [p[0] for p in placements(market)] == ["newcomer@example.com"]

    def test_a_half_built_rule_does_not_break_the_run(self):
        """An organizer mid-edit has a rule with no target yet. That is not an error."""
        market = self._assign_with(
            self._contenders(),
            [(None, [])],
            {
                "returning@example.com": {},
                "newcomer@example.com": {},
            },
        )

        assert len(placements(market)) == 1

    def test_a_multi_select_answer_sorts_by_the_applicants_first_choice(self):
        market = self._assign_with(
            self._contenders(),
            [("category", ["Food", "Vintage"])],
            {
                "returning@example.com": {"category": ["Vintage", "Food"]},
                "newcomer@example.com": {"category": ["Food", "Vintage"]},
            },
        )

        assert [p[0] for p in placements(market)] == ["newcomer@example.com"]


class TestPrioritisingByWhenTheApplicationArrived:
    """First come, first served: probably the most common tiebreaker there is.

    No form question can supply it - it lives on the application itself - so a field-only design
    would have forced organizers to fake it with a "what time is it" question.
    """

    def _race(self, rules, attributes):
        from datatypes import PriorityObject

        wants = [
            VendorWant("early@example.com", available=[DATES[0]], tiers=[GOLD]),
            VendorWant("late@example.com", available=[DATES[0]], tiers=[GOLD]),
        ]
        market = market_for(wants, section_counts=((GOLD, 1),), dates=[DATES[0]])
        market.setup_object.priority = [
            PriorityObject(id=index, **rule) for index, rule in enumerate(rules)
        ]
        vendors = []
        for want in wants:
            vendor = want.as_solver_vendor()
            vendors.append(
                type(vendor)(**{**vendor.__dict__, **attributes[want.email]})
            )
        return assign_market(market, vendors)

    def test_the_earlier_application_takes_the_only_table(self):
        market = self._race(
            [{"target": "application.submitted_at", "direction": "ascending"}],
            {
                "early@example.com": {"submitted_at": "2025-01-05T09:00:00"},
                "late@example.com": {"submitted_at": "2025-02-20T09:00:00"},
            },
        )

        assert [p[0] for p in placements(market)] == ["early@example.com"]

    def test_descending_gives_it_to_the_later_application_instead(self):
        """Only the direction differs from the previous test."""
        market = self._race(
            [{"target": "application.submitted_at", "direction": "descending"}],
            {
                "early@example.com": {"submitted_at": "2025-01-05T09:00:00"},
                "late@example.com": {"submitted_at": "2025-02-20T09:00:00"},
            },
        )

        assert [p[0] for p in placements(market)] == ["late@example.com"]

    def test_an_application_with_no_recorded_time_sorts_last_rather_than_first(self):
        market = self._race(
            [{"target": "application.submitted_at", "direction": "ascending"}],
            {
                "early@example.com": {"submitted_at": None},
                "late@example.com": {"submitted_at": "2025-02-20T09:00:00"},
            },
        )

        assert [p[0] for p in placements(market)] == ["late@example.com"], (
            "an absent answer is not evidence of anything, so it must not win by default"
        )

    def test_every_applicant_sharing_one_timestamp_leaves_the_rule_deciding_nothing(self):
        """The trap behind the constraint that submission time be REAL, not import time."""
        market = self._race(
            [{"target": "application.submitted_at", "direction": "ascending"}],
            {
                "early@example.com": {"submitted_at": "2025-03-01T10:00:00"},
                "late@example.com": {"submitted_at": "2025-03-01T10:00:00"},
            },
        )

        assert len(placements(market)) == 1

    def test_the_application_type_is_selectable_as_a_target(self):
        market = self._race(
            [{"target": "application.application_type", "ordering": ["waitlist", "main"]}],
            {
                "early@example.com": {"application_type": "main"},
                "late@example.com": {"application_type": "waitlist"},
            },
        )

        assert [p[0] for p in placements(market)] == ["late@example.com"]


class TestOrderingByMagnitude:
    def _two(self, rule, answers):
        from datatypes import PriorityObject

        wants = [
            VendorWant("first@example.com", available=[DATES[0]], tiers=[GOLD]),
            VendorWant("second@example.com", available=[DATES[0]], tiers=[GOLD]),
        ]
        market = market_for(wants, section_counts=((GOLD, 1),), dates=[DATES[0]])
        market.setup_object.priority = [PriorityObject(id=1, **rule)]
        vendors = []
        for want in wants:
            vendor = want.as_solver_vendor()
            vendors.append(
                type(vendor)(
                    **{**vendor.__dict__, "custom_answers": {"answer": answers[want.email]}}
                )
            )
        return assign_market(market, vendors)

    def test_a_number_orders_ascending(self):
        market = self._two(
            {"target": "answer", "direction": "ascending"},
            {"first@example.com": 2, "second@example.com": 9},
        )

        assert [p[0] for p in placements(market)] == ["first@example.com"]

    def test_a_number_orders_descending(self):
        market = self._two(
            {"target": "answer", "direction": "descending"},
            {"first@example.com": 2, "second@example.com": 9},
        )

        assert [p[0] for p in placements(market)] == ["second@example.com"]

    def test_a_numeric_zero_is_zero_and_not_a_word_that_looks_false(self):
        market = self._two(
            {"target": "answer", "direction": "ascending"},
            {"first@example.com": 0, "second@example.com": 1},
        )

        assert [p[0] for p in placements(market)] == ["first@example.com"]

    def test_a_yes_no_answer_puts_yes_first_when_ascending(self):
        market = self._two(
            {"target": "answer", "direction": "ascending"},
            {"first@example.com": False, "second@example.com": True},
        )

        assert [p[0] for p in placements(market)] == ["second@example.com"]

    def test_a_date_orders_earliest_first_when_ascending(self):
        market = self._two(
            {"target": "answer", "direction": "ascending"},
            {"first@example.com": "2024-07-01", "second@example.com": "2020-01-01"},
        )

        assert [p[0] for p in placements(market)] == ["second@example.com"]

    def test_an_arranged_rule_and_a_magnitude_rule_combine_in_order(self):
        from datatypes import PriorityObject

        wants = [
            VendorWant("a@example.com", available=[DATES[0]], tiers=[GOLD]),
            VendorWant("b@example.com", available=[DATES[0]], tiers=[GOLD]),
        ]
        market = market_for(wants, section_counts=((GOLD, 1),), dates=[DATES[0]])
        market.setup_object.priority = [
            PriorityObject(id=1, target="tier_answer", ordering=["gold", "bronze"]),
            PriorityObject(id=2, target="application.submitted_at", direction="ascending"),
        ]
        vendors = []
        for want, tier_answer, submitted in (
            (wants[0], "bronze", "2025-01-01T00:00:00"),
            (wants[1], "gold", "2025-06-01T00:00:00"),
        ):
            vendor = want.as_solver_vendor()
            vendors.append(
                type(vendor)(
                    **{
                        **vendor.__dict__,
                        "custom_answers": {"tier_answer": tier_answer},
                        "submitted_at": submitted,
                    }
                )
            )
        assigned = assign_market(market, vendors)

        assert [p[0] for p in placements(assigned)] == ["b@example.com"], (
            "the first rule decides; arriving earlier must not overturn it"
        )


class TestSectionPreference:
    """A vendor's ranked section preference decides which table they reach.

    Honoured as a placement preference: not an optimisation objective, and not a tie-break. A
    ranking is a permutation of the whole offering, so it excludes nothing and cannot act as a
    filter - which is what separates it from tier, a hard filter, where the tier decides what the
    applicant pays.
    """

    SECTIONS = (f"Section {GOLD}", f"Section {SILVER}")

    def test_a_vendor_gets_the_section_they_ranked_first(self):
        market = assign([
            VendorWant("picky@example.com", available=[DATES[0]], tiers=[GOLD, SILVER],
                       sections=(f"Section {SILVER}", f"Section {GOLD}")),
        ])

        assert [p[4] for p in placements(market)] == [f"Section {SILVER}"]

    def test_the_opposite_ranking_sends_them_to_the_other_section(self):
        """Only the ranking differs between this and the previous test."""
        market = assign([
            VendorWant("picky@example.com", available=[DATES[0]], tiers=[GOLD, SILVER],
                       sections=(f"Section {GOLD}", f"Section {SILVER}")),
        ])

        assert [p[4] for p in placements(market)] == [f"Section {GOLD}"]

    def test_a_vendor_whose_top_section_is_full_still_gets_their_next_best(self):
        wants = [
            VendorWant(f"first{i}@example.com", available=[DATES[0]], tiers=[GOLD, SILVER],
                       sections=(f"Section {GOLD}", f"Section {SILVER}"))
            for i in range(3)
        ]
        market = assign(wants)

        placed_sections = [p[4] for p in placements(market)]
        assert placed_sections.count(f"Section {GOLD}") == 2
        assert placed_sections.count(f"Section {SILVER}") == 1

    def test_no_vendor_is_left_unassigned_because_a_preferred_section_filled_up(self):
        wants = [
            VendorWant(f"v{i}@example.com", available=[DATES[0]], tiers=[GOLD, SILVER],
                       sections=(f"Section {GOLD}", f"Section {SILVER}"))
            for i in range(4)
        ]
        market = assign(wants)

        assert len({p[0] for p in placements(market)}) == 4

    def test_preference_never_overrides_tier(self):
        market = assign([
            VendorWant("gold_only@example.com", available=[DATES[0]], tiers=[GOLD],
                       sections=(f"Section {SILVER}", f"Section {GOLD}")),
        ])

        assert [p[5] for p in placements(market)] == [GOLD], (
            "a preferred section at a tier they refused is not an option"
        )

    def test_preference_never_overrides_priority_order(self):
        from datatypes import PriorityObject

        wants = [
            VendorWant("low@example.com", available=[DATES[0]], tiers=[GOLD],
                       sections=(f"Section {GOLD}",)),
            VendorWant("high@example.com", available=[DATES[0]], tiers=[GOLD],
                       sections=(f"Section {GOLD}",)),
        ]
        market = market_for(wants, section_counts=((GOLD, 1),), dates=[DATES[0]])
        market.setup_object.priority = [
            PriorityObject(id=1, target="rank", ordering=["first", "second"])
        ]
        vendors = []
        for want, rank in ((wants[0], "second"), (wants[1], "first")):
            vendor = want.as_solver_vendor()
            vendors.append(
                type(vendor)(**{**vendor.__dict__, "custom_answers": {"rank": rank}})
            )
        assigned = assign_market(market, vendors)

        assert [p[0] for p in placements(assigned)] == ["high@example.com"]

    def test_a_vendor_who_ranked_nothing_is_still_placed(self):
        market = assign([
            VendorWant("nopref@example.com", available=[DATES[0]], tiers=[GOLD, SILVER]),
        ])

        assert len(placements(market)) == 1


class TestTheSameMarketAssignsTheSameWayTwice:
    """Determinism matters to an organizer who re-runs assignment and compares.

    Vendor order used to fall through to whatever the database returned once priority and
    flexibility had nothing left to say.
    """

    def _contenders(self):
        return [
            VendorWant("later@example.com", available=[DATES[0]], tiers=[GOLD]),
            VendorWant("earlier@example.com", available=[DATES[0]], tiers=[GOLD]),
        ]

    def _assign_one_table(self, order, submitted):
        market = market_for(order, section_counts=((GOLD, 1),), dates=[DATES[0]])
        vendors = []
        for want in order:
            vendor = want.as_solver_vendor()
            vendors.append(
                type(vendor)(**{**vendor.__dict__, "submitted_at": submitted[want.email]})
            )
        return assign_market(market, vendors)

    def test_the_earlier_application_wins_a_tie_nothing_else_separates(self):
        submitted = {
            "earlier@example.com": "2025-01-01T09:00:00",
            "later@example.com": "2025-02-01T09:00:00",
        }

        market = self._assign_one_table(self._contenders(), submitted)

        assert [p[0] for p in placements(market)] == ["earlier@example.com"]

    def test_the_input_order_does_not_decide_it(self):
        """The same two vendors, handed over in the opposite order, place the same person."""
        submitted = {
            "earlier@example.com": "2025-01-01T09:00:00",
            "later@example.com": "2025-02-01T09:00:00",
        }
        forwards = self._assign_one_table(self._contenders(), submitted)
        backwards = self._assign_one_table(list(reversed(self._contenders())), submitted)

        assert [p[0] for p in placements(forwards)] == [p[0] for p in placements(backwards)]

    def test_vendors_with_no_recorded_time_are_still_ordered_reproducibly(self):
        submitted = {"earlier@example.com": None, "later@example.com": None}

        forwards = self._assign_one_table(self._contenders(), submitted)
        backwards = self._assign_one_table(list(reversed(self._contenders())), submitted)

        assert [p[0] for p in placements(forwards)] == [p[0] for p in placements(backwards)]


class TestTheSolverWorksAroundPins:
    """A pin is a guarantee, not a preference (E11/F02/S01).

    A hand-placed row survives a re-run untouched, and everyone else is placed around it as
    though that seat were simply occupied.
    """

    def test_a_pinned_placement_survives_a_re_run_unchanged(self):
        market = assign(
            [
                VendorWant("pinned@example.com", available=DATES, tiers=[GOLD]),
                VendorWant("other@example.com", available=DATES, tiers=[GOLD]),
            ],
            pins=[pin("pinned@example.com", DATES[0], f"Section {GOLD} 2")],
        )

        assert seat_of(market, "pinned@example.com", DATES[0]) == (
            f"Section {GOLD} 2",
            "Full Table",
        )

    def test_a_pin_is_still_a_pin_after_the_run(self):
        """The flag has to survive, or the next re-run treats the seat as the solver's to move."""
        market = assign(
            [VendorWant("pinned@example.com", available=DATES, tiers=[GOLD])],
            pins=[pin("pinned@example.com", DATES[0], f"Section {GOLD} 1")],
        )

        pinned_rows = [
            row
            for row in market.assignment_object.vendor_assignments
            if row.hand_placed
        ]
        assert [(row.email, row.date) for row in pinned_rows] == [
            ("pinned@example.com", DATES[0])
        ]

    def test_nobody_else_is_given_the_pinned_seat(self):
        """Two vendors, one Gold table on the day: the pin takes it and the other goes elsewhere."""
        market = assign(
            [
                VendorWant("pinned@example.com", available=[DATES[0]], tiers=[GOLD]),
                VendorWant("other@example.com", available=[DATES[0]], tiers=[GOLD, SILVER]),
            ],
            pins=[pin("pinned@example.com", DATES[0], f"Section {GOLD} 1")],
            section_counts=((GOLD, 1), (SILVER, 1)),
        )

        assert seat_of(market, "pinned@example.com", DATES[0]) == (
            f"Section {GOLD} 1",
            "Full Table",
        )
        assert seat_of(market, "other@example.com", DATES[0]) == (
            f"Section {SILVER} 1",
            "Full Table",
        )

    def test_everyone_else_is_placed_as_if_the_seat_were_simply_occupied(self):
        """The pin's only effect is availability - no special case beyond that.

        Pinning the vendor the solver would have placed there anyway must produce exactly the
        assignment the solver produces on its own.
        """
        wants = [
            VendorWant("a@example.com", available=DATES, tiers=[GOLD, SILVER]),
            VendorWant("b@example.com", available=DATES, tiers=[GOLD, SILVER]),
            VendorWant("c@example.com", available=DATES, tiers=[GOLD, SILVER]),
        ]
        unpinned = assign(wants)
        seat = seat_of(unpinned, "a@example.com", DATES[0])
        assert seat is not None

        pinned = assign(
            wants,
            pins=[
                pin("a@example.com", DATES[0], seat[0], seat[1],
                    section=f"Section {GOLD}", tier=GOLD)
            ],
        )

        assert sorted(placements(pinned)) == sorted(placements(unpinned))

    def test_a_pinned_vendor_counts_against_their_own_ceiling(self):
        """The pinned date is a date they took, so a one-date ceiling is already spent."""
        market = assign(
            [VendorWant("pinned@example.com", available=DATES, tiers=[GOLD], max_days=1)],
            pins=[pin("pinned@example.com", DATES[0], f"Section {GOLD} 1")],
        )

        assert dates_for(market, "pinned@example.com") == [DATES[0]]

    def test_a_half_table_pin_counts_against_the_sections_half_table_proportion(self):
        """A pinned half is a real half on a real date, so the cap has to see it."""
        market = assign(
            [
                VendorWant("pinned@example.com", available=[DATES[0]], tiers=[GOLD],
                           table_choice="half"),
                VendorWant("either@example.com", available=[DATES[0]], tiers=[GOLD],
                           table_choice="either"),
            ],
            pins=[
                pin("pinned@example.com", DATES[0], f"Section {GOLD} 1", "Half Table (Left)")
            ],
            section_counts=((GOLD, 3),),
            half_proportion=100,
        )

        # The pinned half is one of the section's half tables; with the cap already met by it,
        # the "either" vendor is given a whole table rather than another half.
        assert seat_of(market, "pinned@example.com", DATES[0]) == (
            f"Section {GOLD} 1",
            "Half Table (Left)",
        )

    def test_the_open_half_of_a_pinned_table_can_still_be_filled(self):
        """A pin takes one seat, not the table. The other half must stay usable.

        The ordinary loop fills both halves of a table in one step, so before pins existed a
        half-occupied table never occurred; leaving it out of consideration would strand the
        open half of every half-table pin for the whole run.
        """
        market = assign(
            [
                VendorWant("pinned@example.com", available=[DATES[0]], tiers=[GOLD],
                           table_choice="half"),
                VendorWant("sharer@example.com", available=[DATES[0]], tiers=[GOLD],
                           table_choice="half"),
            ],
            pins=[
                pin("pinned@example.com", DATES[0], f"Section {GOLD} 1", "Half Table (Left)")
            ],
            section_counts=((GOLD, 2),),
        )

        assert seat_of(market, "sharer@example.com", DATES[0]) == (
            f"Section {GOLD} 1",
            "Half Table (Right)",
        )

    def test_a_full_table_vendor_is_not_squeezed_into_a_pinned_half(self):
        market = assign(
            [
                VendorWant("pinned@example.com", available=[DATES[0]], tiers=[GOLD],
                           table_choice="half"),
                VendorWant("whole@example.com", available=[DATES[0]], tiers=[GOLD],
                           table_choice="full"),
            ],
            pins=[
                pin("pinned@example.com", DATES[0], f"Section {GOLD} 1", "Half Table (Left)")
            ],
            section_counts=((GOLD, 2),),
        )

        assert seat_of(market, "whole@example.com", DATES[0]) == (
            f"Section {GOLD} 2",
            "Full Table",
        )

    def test_pinning_before_any_solver_run_produces_a_valid_assignment(self):
        """Pinning with nothing assigned yet is just writing a row early - no extra machinery."""
        market = assign(
            [
                VendorWant("early@example.com", available=[DATES[0]], tiers=[GOLD]),
                VendorWant("later@example.com", available=[DATES[0]], tiers=[GOLD]),
            ],
            pins=[pin("early@example.com", DATES[0], f"Section {GOLD} 2")],
            section_counts=((GOLD, 2),),
        )

        assert sorted(placements(market)) == sorted([
            ("early@example.com", DATES[0], f"Section {GOLD} 2", "Full Table",
             f"Section {GOLD}", GOLD),
            ("later@example.com", DATES[0], f"Section {GOLD} 1", "Full Table",
             f"Section {GOLD}", GOLD),
        ])

    def test_a_pin_the_plan_can_no_longer_hold_is_kept_rather_than_dropped(self):
        """Dropping the section a pin sits in orphans it; it is not deleted (E11/F02/S02)."""
        market = assign(
            [VendorWant("pinned@example.com", available=[DATES[0]], tiers=[GOLD])],
            pins=[pin("pinned@example.com", DATES[0], f"Section {GOLD} 9")],
            section_counts=((GOLD, 1),),
        )

        assert seat_of(market, "pinned@example.com", DATES[0]) == (
            f"Section {GOLD} 9",
            "Full Table",
        )

    def test_a_vendor_whose_pin_is_orphaned_is_not_quietly_moved_elsewhere(self):
        """One date, one row. Re-placing them would answer the orphan's question by itself."""
        market = assign(
            [VendorWant("pinned@example.com", available=[DATES[0]], tiers=[GOLD])],
            pins=[pin("pinned@example.com", DATES[0], f"Section {GOLD} 9")],
            section_counts=((GOLD, 1),),
        )

        rows = [p for p in placements(market) if p[0] == "pinned@example.com"]
        assert len(rows) == 1

    def test_a_pin_for_a_vendor_this_market_no_longer_has_is_still_kept(self):
        market = assign(
            [VendorWant("still-here@example.com", available=[DATES[0]], tiers=[GOLD])],
            pins=[pin("withdrawn@example.com", DATES[0], f"Section {GOLD} 1")],
            section_counts=((GOLD, 2),),
        )

        assert seat_of(market, "withdrawn@example.com", DATES[0]) == (
            f"Section {GOLD} 1",
            "Full Table",
        )


class TestDescribingWhatIsStored:
    """Read-only views describe the STORED assignment, never a fresh run (E11/F03/S01).

    Every one of them used to run the solver again. That was harmless while the browser stored
    whatever it had been handed; it is not harmless once an organizer edits one seat at a time,
    because a grid drawn from a fresh run is a picture of what WOULD happen if they pressed
    Assign, and every seat they moved a vendor into would be a seat they had never seen.
    """

    def _market_with(self, wants, placements, **kwargs):
        market = market_for(wants, **kwargs)
        market.assignment_object = AssignmentObject(vendor_assignments=list(placements))
        return market

    def test_the_stored_rows_are_what_comes_back(self):
        wants = [VendorWant("ana@example.com", available=DATES, tiers=[GOLD])]
        stored = pin("ana@example.com", DATES[0], f"Section {GOLD} 2")
        market = self._market_with(wants, [stored])

        described = describe_stored_assignment(
            market, [want.as_solver_vendor() for want in wants]
        )

        assert described.assignment_object.vendor_assignments == [stored]

    def test_the_solver_is_not_run(self):
        """A vendor the solver would have placed stays unplaced if the stored run did not."""
        wants = [
            VendorWant("ana@example.com", available=[DATES[0]], tiers=[GOLD]),
            VendorWant("ben@example.com", available=[DATES[0]], tiers=[GOLD]),
        ]
        market = self._market_with(wants, [pin("ana@example.com", DATES[0], f"Section {GOLD} 1")])

        described = describe_stored_assignment(
            market, [want.as_solver_vendor() for want in wants]
        )

        assert [p[0] for p in placements(described)] == ["ana@example.com"]

    def test_the_statistics_describe_the_stored_rows(self):
        wants = [
            VendorWant("ana@example.com", available=[DATES[0]], tiers=[GOLD]),
            VendorWant("ben@example.com", available=[DATES[0]], tiers=[GOLD]),
        ]
        market = self._market_with(
            wants,
            [pin("ana@example.com", DATES[0], f"Section {GOLD} 1")],
            dates=[DATES[0]],
        )

        stats = describe_stored_assignment(
            market, [want.as_solver_vendor() for want in wants]
        ).assignment_object.assignment_statistics

        assert stats.total_assignments == 1
        assert stats.total_assigned_vendors == 1
        assert stats.unassigned_vendors == ["ben@example.com"]

    def test_a_stored_assignment_survives_a_plan_that_shrank_under_it(self):
        """Shrinking the plan does not unassign anybody: only assigning again does that."""
        wants = [VendorWant("ana@example.com", available=[DATES[0]], tiers=[GOLD])]
        stored = pin("ana@example.com", DATES[0], f"Section {GOLD} 2")
        market = self._market_with(
            wants, [stored], section_counts=((GOLD, 1),), dates=[DATES[0]]
        )

        described = describe_stored_assignment(
            market, [want.as_solver_vendor() for want in wants]
        )

        assert described.assignment_object.vendor_assignments == [stored]
