"""The solver's input contract: an ``Application`` seen as a vendor the solver can place.

These tests never construct a ``MarketAssignment`` and never reach a database. That is the
point of the seam: the translation is the one place application shape meets solver shape, so
it should be provable on its own.
"""
import pytest

from assignment.vendor_input import (
    IncompleteApplication,
    SolverVendor,
    approved_solver_vendors,
    solver_vendors_from_applications,
)
from datatypes import Application, ApplicationStatus, ApplicationType, EssentialFormOptions
import essential_fields as EF


FULL_OFFERING = EssentialFormOptions(
    dates=["2026-06-01", "2026-06-02", "2026-06-03"],
    sections=["Artisan", "Food", "Vintage"],
    table_types=[EF.STUB_TABLE_TYPE],
    tiers=["A", "AB", "B"],
)


def answers(**overrides):
    """A complete set of essential answers against ``FULL_OFFERING``."""
    base = {
        EF.AVAILABLE_DATES_KEY: ["2026-06-01", "2026-06-02"],
        EF.MAX_DATES_KEY: 2,
        EF.TIER_PREFERENCE_KEY: ["A", "B"],
        EF.TABLE_CHOICE_KEY: EF.TABLE_CHOICE_HALF,
        EF.TABLE_SHARE_EMAIL_KEY: "partner@example.com",
        EF.SECTION_RANKING_KEY: ["Food", "Artisan", "Vintage"],
        EF.TABLE_TYPE_RANKING_KEY: [],
    }
    base.update(overrides)
    return base


def application(email="vendor@example.com", app_id="app-1", **overrides):
    return Application(
        id=app_id,
        market_id="market-1",
        applicant_email=email,
        form_data=answers(**overrides),
        status=ApplicationStatus.REVIEWER_APPROVED,
    )


class TestBuildingAVendor:
    def test_it_carries_every_essential_field_as_a_named_attribute(self):
        vendors, incomplete = solver_vendors_from_applications(
            [application()], FULL_OFFERING
        )

        assert incomplete == []
        vendor, = vendors
        assert vendor.email == "vendor@example.com"
        assert vendor.available_dates == frozenset({"2026-06-01", "2026-06-02"})
        assert vendor.max_dates == 2
        assert vendor.accepted_tiers == frozenset({"A", "B"})
        assert vendor.table_choice == EF.TABLE_CHOICE_HALF
        assert vendor.table_share_email == "partner@example.com"
        assert vendor.section_ranking == ("Food", "Artisan", "Vintage")
        assert vendor.table_type_ranking == ()
        assert vendor.application_id == "app-1"

    def test_a_missing_attribute_raises_rather_than_reading_as_a_blank_answer(self):
        """The whole reason for the typed model.

        The old vendor was a bag of attributes named after spreadsheet headings, read back
        with a defaulting ``getattr``, so a renamed field read as 'answered nothing'.
        """
        vendors, _ = solver_vendors_from_applications([application()], FULL_OFFERING)

        with pytest.raises(AttributeError):
            vendors[0].max_days  # the CSV-era spelling

    def test_the_vendor_record_is_immutable(self):
        vendors, _ = solver_vendors_from_applications([application()], FULL_OFFERING)

        with pytest.raises(Exception):
            vendors[0].email = "someone-else@example.com"


class TestTypesTheCsvEraGotWrong:
    def test_the_number_of_dates_wanted_is_an_integer(self):
        vendors, _ = solver_vendors_from_applications([application()], FULL_OFFERING)

        assert isinstance(vendors[0].max_dates, int)
        assert not isinstance(vendors[0].max_dates, bool)

    def test_a_vendor_wanting_twelve_dates_is_not_truncated_to_one(self):
        """``int(max_days_val[0])`` read one character, so '12' became 1."""
        offering = EssentialFormOptions(
            dates=[f"2026-06-{day:02d}" for day in range(1, 13)],
            sections=FULL_OFFERING.sections,
            table_types=FULL_OFFERING.table_types,
            tiers=FULL_OFFERING.tiers,
        )
        app = application(
            **{
                EF.AVAILABLE_DATES_KEY: offering.dates,
                EF.MAX_DATES_KEY: 12,
            }
        )

        vendors, incomplete = solver_vendors_from_applications([app], offering)

        assert incomplete == []
        assert vendors[0].max_dates == 12

    def test_available_dates_are_a_set_not_a_string_to_split(self):
        vendors, _ = solver_vendors_from_applications([application()], FULL_OFFERING)

        assert isinstance(vendors[0].available_dates, frozenset)
        assert "2026-06-03" not in vendors[0].available_dates

    def test_accepted_tiers_are_a_set_so_one_tier_name_never_matches_another(self):
        """'A' used to match an answer of 'AB' under the old substring test."""
        vendors, _ = solver_vendors_from_applications([application()], FULL_OFFERING)

        assert "AB" not in vendors[0].accepted_tiers
        assert "A" in vendors[0].accepted_tiers


class TestTheOptionalPartner:
    def test_a_named_partner_is_carried(self):
        vendors, _ = solver_vendors_from_applications([application()], FULL_OFFERING)

        assert vendors[0].table_share_email == "partner@example.com"

    @pytest.mark.parametrize("stored", ["", "   ", None])
    def test_naming_nobody_is_absent_not_an_empty_string(self, stored):
        app = application(**{EF.TABLE_SHARE_EMAIL_KEY: stored})

        vendors, incomplete = solver_vendors_from_applications([app], FULL_OFFERING)

        assert incomplete == []
        assert vendors[0].table_share_email is None

    def test_naming_nobody_is_never_a_missing_answer(self):
        app = application(**{EF.TABLE_SHARE_EMAIL_KEY: ""})

        _, incomplete = solver_vendors_from_applications([app], FULL_OFFERING)

        assert incomplete == []


class TestReportingAnIncompleteApplication:
    @pytest.mark.parametrize(
        "key,label",
        [
            (EF.AVAILABLE_DATES_KEY, EF.AVAILABLE_DATES_LABEL),
            (EF.MAX_DATES_KEY, EF.MAX_DATES_LABEL),
            (EF.TIER_PREFERENCE_KEY, EF.TIER_PREFERENCE_LABEL),
            (EF.TABLE_CHOICE_KEY, EF.TABLE_CHOICE_LABEL),
            (EF.SECTION_RANKING_KEY, EF.SECTION_RANKING_LABEL),
        ],
    )
    def test_a_required_answer_the_market_asked_for_is_reported_when_absent(self, key, label):
        app = application(**{key: None})

        vendors, incomplete = solver_vendors_from_applications([app], FULL_OFFERING)

        assert vendors == []
        assert len(incomplete) == 1
        assert incomplete[0].applicant_email == "vendor@example.com"
        assert incomplete[0].application_id == "app-1"
        assert label in incomplete[0].missing

    def test_an_incomplete_application_never_becomes_a_blank_answered_vendor(self):
        app = application(**{EF.AVAILABLE_DATES_KEY: []})

        vendors, incomplete = solver_vendors_from_applications([app], FULL_OFFERING)

        assert vendors == []
        assert incomplete

    def test_every_missing_answer_is_named_at_once(self):
        app = application(
            **{EF.AVAILABLE_DATES_KEY: None, EF.TABLE_CHOICE_KEY: None}
        )

        _, incomplete = solver_vendors_from_applications([app], FULL_OFFERING)

        assert EF.AVAILABLE_DATES_LABEL in incomplete[0].missing
        assert EF.TABLE_CHOICE_LABEL in incomplete[0].missing

    def test_an_applicant_with_no_address_is_reported(self):
        app = application()
        app.applicant_email = "   "

        vendors, incomplete = solver_vendors_from_applications([app], FULL_OFFERING)

        assert vendors == []
        assert incomplete[0].missing

    def test_the_complete_applications_still_build(self):
        good = application(email="good@example.com", app_id="app-good")
        bad = application(
            email="bad@example.com", app_id="app-bad", **{EF.MAX_DATES_KEY: None}
        )

        vendors, incomplete = solver_vendors_from_applications(
            [good, bad], FULL_OFFERING
        )

        assert [v.email for v in vendors] == ["good@example.com"]
        assert [i.applicant_email for i in incomplete] == ["bad@example.com"]


class TestWhatTheMarketDidNotAsk:
    def test_the_stubbed_table_type_ranking_is_not_required(self):
        """One offered type is not a question, so an empty ranking is a complete answer."""
        vendors, incomplete = solver_vendors_from_applications(
            [application()], FULL_OFFERING
        )

        assert incomplete == []
        assert vendors[0].table_type_ranking == ()

    def test_a_single_section_market_does_not_require_a_section_ranking(self):
        offering = EssentialFormOptions(
            dates=FULL_OFFERING.dates,
            sections=["Artisan"],
            table_types=[EF.STUB_TABLE_TYPE],
            tiers=FULL_OFFERING.tiers,
        )
        app = application(**{EF.SECTION_RANKING_KEY: []})

        vendors, incomplete = solver_vendors_from_applications([app], offering)

        assert incomplete == []
        assert vendors[0].section_ranking == ()

    def test_a_market_offering_no_tiers_does_not_require_a_tier_answer(self):
        offering = EssentialFormOptions(
            dates=FULL_OFFERING.dates,
            sections=FULL_OFFERING.sections,
            table_types=[EF.STUB_TABLE_TYPE],
            tiers=[],
        )
        app = application(**{EF.TIER_PREFERENCE_KEY: []})

        vendors, incomplete = solver_vendors_from_applications([app], offering)

        assert incomplete == []
        assert vendors[0].accepted_tiers == frozenset()


class TestOnlyApprovedApplicationsFeedTheSolver:
    def _store(self, applications, docs):
        for doc in docs:
            applications.documents.append(doc)

    def test_it_reads_only_reviewer_approved_applications(self, applications):
        approved = application(email="yes@example.com", app_id="app-yes")
        pending = application(email="no@example.com", app_id="app-no")
        pending.status = ApplicationStatus.OPEN
        rejected = application(email="never@example.com", app_id="app-never")
        rejected.status = ApplicationStatus.REVIEWER_REJECTED
        self._store(
            applications,
            [a.model_dump(mode="json") for a in (approved, pending, rejected)],
        )

        vendors, incomplete = approved_solver_vendors("market-1", FULL_OFFERING)

        assert incomplete == []
        assert [v.email for v in vendors] == ["yes@example.com"]

    def test_another_markets_approved_applications_are_not_read(self, applications):
        mine = application(email="mine@example.com", app_id="app-mine")
        theirs = application(email="theirs@example.com", app_id="app-theirs")
        theirs.market_id = "market-2"
        self._store(
            applications, [a.model_dump(mode="json") for a in (mine, theirs)]
        )

        vendors, _ = approved_solver_vendors("market-1", FULL_OFFERING)

        assert [v.email for v in vendors] == ["mine@example.com"]

    def test_a_market_with_no_approved_applications_yields_none(self, applications):
        vendors, incomplete = approved_solver_vendors("market-1", FULL_OFFERING)

        assert vendors == []
        assert incomplete == []

    def test_an_incomplete_approved_application_is_reported_not_dropped(self, applications):
        bad = application(email="bad@example.com", app_id="app-bad")
        bad.form_data[EF.MAX_DATES_KEY] = None
        self._store(applications, [bad.model_dump(mode="json")])

        vendors, incomplete = approved_solver_vendors("market-1", FULL_OFFERING)

        assert vendors == []
        assert [i.applicant_email for i in incomplete] == ["bad@example.com"]

    def test_a_waitlist_application_does_not_feed_the_solver(self, applications):
        main = application(email="main@example.com", app_id="app-main")
        waitlisted = application(email="wait@example.com", app_id="app-wait")
        waitlisted.application_type = ApplicationType.WAITLIST
        self._store(
            applications, [a.model_dump(mode="json") for a in (main, waitlisted)]
        )

        vendors, _ = approved_solver_vendors("market-1", FULL_OFFERING)

        assert [v.email for v in vendors] == ["main@example.com"]
