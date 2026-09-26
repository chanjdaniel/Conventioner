"""A vendor is called by the name they chose (E19/F02/S01).

The committed export carries Full Legal Name and Preferred Name as adjacent columns, and
`readable-journey` ticket 02 said outright that the product "drops both because it has nowhere to
put them" - then built a home for the legal name only. What it deferred was a TRADING name, which
is a different thing.
"""
import essential_fields as EssentialFields
from datatypes import EssentialFormOptions


EMPTY = EssentialFormOptions(dates=[], sections=[], table_types=[], tiers=[])


class TestWhereItSitsInTheContract:
    def test_it_is_essential(self):
        assert EssentialFields.PREFERRED_NAME_KEY in EssentialFields.asked_essential_keys(EMPTY)

    def test_but_not_required(self):
        # Essential means the product owns the question and every form asks it. Required means an
        # applicant cannot submit without it. The table-share partner already has this shape.
        assert EssentialFields.PREFERRED_NAME_KEY not in EssentialFields.REQUIRED_ESSENTIAL_KEYS

    def test_it_is_asked_unconditionally_like_the_legal_name(self):
        # Every other essential question is gated on the plan offering something. Identity is not.
        assert EssentialFields.PREFERRED_NAME_KEY in EssentialFields.asked_essential_keys(EMPTY)

    def test_the_plan_does_not_gate_it_and_it_does_not_gate_the_plan(self):
        # `plan_derived_asked_keys` is what `FormHasFieldsGuard` counts. A name asked
        # unconditionally must stay out of it, or the guard could never say no.
        assert EssentialFields.PREFERRED_NAME_KEY not in EssentialFields.plan_derived_asked_keys(
            EMPTY
        )

    def test_correcting_it_does_not_invalidate_a_completed_review(self):
        assert EssentialFields.PREFERRED_NAME_KEY not in EssentialFields.SOLVER_RELEVANT_KEYS

    def test_it_cannot_be_declared_unasked(self):
        # That list admits RANKINGS only: a default on a non-ranking invents a commitment the
        # applicant never made.
        assert EssentialFields.PREFERRED_NAME_KEY not in EssentialFields.UNASKABLE_ESSENTIAL_KEYS


class TestAnApplicantsAnswer:
    def test_is_accepted_and_stored(self):
        error, stored = EssentialFields.validated_essential_answers(
            {
                EssentialFields.FULL_NAME_KEY: "Ana Marie Rivera",
                EssentialFields.PREFERRED_NAME_KEY: "Annie",
            },
            EMPTY,
        )

        assert error is None, error
        assert stored[EssentialFields.PREFERRED_NAME_KEY] == "Annie"

    def test_may_be_left_blank(self):
        error, stored = EssentialFields.validated_essential_answers(
            {EssentialFields.FULL_NAME_KEY: "Ana Marie Rivera"}, EMPTY
        )

        assert error is None, error
        assert stored[EssentialFields.PREFERRED_NAME_KEY] == ""

    def test_is_trimmed_like_the_legal_name(self):
        _error, stored = EssentialFields.validated_essential_answers(
            {
                EssentialFields.FULL_NAME_KEY: "Ana Marie Rivera",
                EssentialFields.PREFERRED_NAME_KEY: "  Annie  ",
            },
            EMPTY,
        )

        assert stored[EssentialFields.PREFERRED_NAME_KEY] == "Annie"


class TestExistingApplications:
    def test_one_with_no_preferred_name_is_still_named_by_its_legal_name(self):
        assert EssentialFields.display_name(
            {EssentialFields.FULL_NAME_KEY: "Ana Marie Rivera"}
        ) == "Ana Marie Rivera"

    def test_one_with_a_preferred_name_is_called_by_it(self):
        assert EssentialFields.display_name(
            {
                EssentialFields.FULL_NAME_KEY: "Ana Marie Rivera",
                EssentialFields.PREFERRED_NAME_KEY: "Annie",
            }
        ) == "Annie"

    def test_a_blank_preferred_name_falls_back_rather_than_naming_nobody(self):
        assert EssentialFields.display_name(
            {
                EssentialFields.FULL_NAME_KEY: "Ana Marie Rivera",
                EssentialFields.PREFERRED_NAME_KEY: "   ",
            }
        ) == "Ana Marie Rivera"

    def test_one_written_before_either_key_existed_still_assigns(self):
        """No migration, and this is why.

        `_solver_vendor` names the keys it reads explicitly rather than looping over everything the
        form asks, and stored applications are not re-validated - so an application with neither
        name is invisible to the solver rather than incomplete to it. Asserted rather than assumed,
        because "it should be fine" is how a market stops assigning on the day.
        """
        from assignment.vendor_input import solver_vendors_from_applications
        from datatypes import Application, ApplicationStatus

        nameless = Application(
            id="app-1",
            market_id="market-1",
            applicant_email="nobody@example.com",
            form_data={
                EssentialFields.AVAILABLE_DATES_KEY: ["2026-11-17"],
                EssentialFields.TIER_PREFERENCE_KEY: {"2026-11-17": ["Gold"]},
                EssentialFields.TABLE_CHOICE_KEY: "full",
                EssentialFields.MAX_DATES_KEY: 1,
            },
            status=ApplicationStatus.REVIEWER_APPROVED,
        )
        options = EssentialFormOptions(
            dates=["2026-11-17"], sections=[], table_types=[], tiers=["Gold"]
        )

        vendors, incomplete = solver_vendors_from_applications([nameless], options)

        assert len(vendors) == 1
        assert not incomplete
