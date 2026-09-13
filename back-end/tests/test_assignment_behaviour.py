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
)

DATES = ["2025-03-17", "2025-03-18"]
GOLD = "Gold"
SILVER = "Silver"


class VendorWant:
    """One vendor's ask, in the domain's terms rather than any input format's.

    ``available`` is which dates they can attend and ``tiers`` which tiers they accept - the
    split E02 makes explicit and the CSV encoding conflated into one answer per date.
    """

    def __init__(self, email, available, tiers, table_choice="full",
                 share_with="", max_days=None):
        self.email = email
        self.available = list(available)
        self.tiers = list(tiers)
        self.table_choice = table_choice
        self.share_with = share_with
        self.max_days = max_days

    def as_solver_vendor(self):
        return SolverVendor(
            application_id=f"app-{self.email}",
            email=self.email,
            available_dates=frozenset(self.available),
            max_dates=self.max_days,
            accepted_tiers=frozenset(self.tiers),
            table_choice=self.table_choice,
            table_share_email=self.share_with or None,
            section_ranking=(),
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


def assign(wants, **kwargs):
    market = market_for(wants, **kwargs)
    return assign_market(market, [want.as_solver_vendor() for want in wants])


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
                    EF.TIER_PREFERENCE_KEY: want.tiers,
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


class TestKnownDefectTheTableLoopStopsEarly:
    """Pinned, not fixed: this is pre-existing and fixing it here would move placement.

    ``assign`` breaks out of the table loop the moment one table cannot be filled, but
    ``get_valid_vendors`` answers per TABLE - a vendor who accepts only Silver is not valid for a
    Gold table. So an unfillable table early in the list ends the date, and every later table is
    left empty however many vendors could have taken one.

    E02/F01/S02 deliberately preserves it so the input swap's diff stays free of placement
    changes. E02/F03/S01 inverts this loop and is where it gets fixed; this test is the witness
    that it was known, and should be inverted to assert the vendor IS placed once it is.
    """

    def test_a_vendor_is_stranded_behind_a_table_they_could_not_take(self):
        market = assign([
            VendorWant("gold@example.com", available=[DATES[0]], tiers=[GOLD]),
            VendorWant("silver@example.com", available=[DATES[0]], tiers=[SILVER]),
        ])

        placed = {p[0] for p in placements(market)}
        assert "gold@example.com" in placed
        assert "silver@example.com" not in placed, (
            "known defect: the Silver tables are never reached. Fix in E02/F03/S01."
        )


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
                    EF.TIER_PREFERENCE_KEY: [GOLD],
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
