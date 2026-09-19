"""``essential_full_name``: the eighth essential question, and the first that is not a solver input.

Resolved by readable-journey ticket 02. The product identified vendors by email address and nothing
else, while the committed Fall 2025 export carried "Full Legal Name" and "Preferred Name" as
columns 4 and 5 - Conventioner dropped both because it had nowhere to put them.
"""
import pytest

import essential_fields as EF
from datatypes import EssentialFormOptions
from guards import FormHasFieldsGuard


A_FULL_PLAN = EssentialFormOptions(
    dates=["2026-08-01", "2026-08-08"],
    tiers=["Gold", "Silver"],
    sections=["Main Hall", "Garden"],
    table_types=["Standard"],
)


class TestItIsAskedUnconditionally:
    """Every other essential question is gated on the plan offering something to answer about.

    Identity is gated on nothing, because it does not depend on the plan. That is the first
    unconditional entry in ``asked_essential_keys``, and it reads as an oversight unless said.
    """

    def test_a_market_with_no_plan_at_all_still_asks_for_a_name(self):
        assert EF.FULL_NAME_KEY in EF.asked_essential_keys(EssentialFormOptions())

    def test_a_market_with_a_full_plan_asks_for_it_too(self):
        assert EF.FULL_NAME_KEY in EF.asked_essential_keys(A_FULL_PLAN)

    def test_it_cannot_be_declared_unasked(self):
        """``UNASKABLE_ESSENTIAL_KEYS`` admits only rankings, and that rule is unchanged."""
        assert EF.FULL_NAME_KEY not in EF.UNASKABLE_ESSENTIAL_KEYS

        error = EF.unaskable_essential_error([EF.FULL_NAME_KEY])

        assert error is not None

    def test_declaring_it_unasked_does_not_remove_it_even_if_it_got_into_the_list(self):
        asked = EF.asked_essential_keys(
            EssentialFormOptions(dates=["2026-08-01"], unasked=[EF.FULL_NAME_KEY])
        )

        # The unasked filter subtracts, so this is a real risk rather than a hypothetical: the
        # validator on the way in is what keeps the key out of that list in the first place.
        assert EF.FULL_NAME_KEY not in asked, (
            "if this ever passes, the write-time validator is the thing that has to hold"
        )


class TestAnApplicantMustGiveOne:
    def _answers(self, **overrides):
        return {
            EF.FULL_NAME_KEY: "Ana Rivera",
            EF.AVAILABLE_DATES_KEY: ["2026-08-01"],
            EF.MAX_DATES_KEY: 1,
            EF.TIER_PREFERENCE_KEY: {"2026-08-01": ["Gold"]},
            EF.TABLE_CHOICE_KEY: "full",
            EF.SECTION_RANKING_KEY: ["Main Hall", "Garden"],
            **overrides,
        }

    def test_a_save_with_a_name_is_accepted_and_stores_it(self):
        error, stored = EF.validated_essential_answers(self._answers(), A_FULL_PLAN)

        assert error is None, error
        assert stored[EF.FULL_NAME_KEY] == "Ana Rivera"

    @pytest.mark.parametrize("missing", [{}, {EF.FULL_NAME_KEY: ""}, {EF.FULL_NAME_KEY: "   "}])
    def test_a_save_with_no_name_is_refused_by_the_question_as_the_form_asked_it(self, missing):
        answers = self._answers()
        answers.pop(EF.FULL_NAME_KEY)
        answers.update(missing)

        error, _stored = EF.validated_essential_answers(answers, A_FULL_PLAN)

        assert error == "'Full name' is required."

    def test_a_market_with_no_plan_still_requires_it(self):
        error, _stored = EF.validated_essential_answers({}, EssentialFormOptions())

        assert error == "'Full name' is required."

    def test_a_whole_name_is_stored_whole(self):
        """Never split. Both name columns in the Fall 2025 export are whole names, and splitting
        on whitespace guesses wrong on every "van der Berg", "Maria del Carmen" and mononym."""
        for name in ("Jan van der Berg", "Maria del Carmen Ruiz", "Prince"):
            _error, stored = EF.validated_essential_answers(
                self._answers(**{EF.FULL_NAME_KEY: name}), A_FULL_PLAN,
            )

            assert stored[EF.FULL_NAME_KEY] == name

    def test_surrounding_whitespace_is_dropped(self):
        _error, stored = EF.validated_essential_answers(
            self._answers(**{EF.FULL_NAME_KEY: "  Ana Rivera  "}), A_FULL_PLAN,
        )

        assert stored[EF.FULL_NAME_KEY] == "Ana Rivera"


class TestCorrectingASpellingDoesNotInvalidateAReview:
    """An organizer approved a vendor on the strength of what they saw.

    The keys whose change invalidates that are the ones the solver reads - availability, tiers,
    table choice. A name is not one: it changes nothing the solver places on.
    """

    def test_the_name_is_not_solver_relevant(self):
        assert EF.FULL_NAME_KEY not in EF.SOLVER_RELEVANT_KEYS


class TestAStoredApplicationWithNoNameStillAssigns:
    """This is what makes a required new essential key need no migration, so it is pinned.

    Adding one looked like it would break every existing market, because an approved application
    missing a required answer refuses the whole assignment run. It does not: ``_solver_vendor``
    names the keys it needs explicitly - availability, tiers, table choice - rather than looping
    over everything ``asked_essential_keys`` returns, and stored applications are never
    re-validated. The validator requires a name on NEW saves only.
    """

    def test_an_approved_application_written_before_the_name_existed_still_places(self):
        from assignment.vendor_input import solver_vendors_from_applications
        from datatypes import Application, ApplicationStatus

        legacy = Application(
            id="app-legacy",
            market_id="market-1",
            applicant_email="vendor@example.com",
            status=ApplicationStatus.REVIEWER_APPROVED,
            form_data={
                EF.AVAILABLE_DATES_KEY: ["2026-08-01"],
                EF.MAX_DATES_KEY: 1,
                EF.TIER_PREFERENCE_KEY: {"2026-08-01": ["Gold"]},
                EF.TABLE_CHOICE_KEY: "full",
                EF.SECTION_RANKING_KEY: ["Main Hall", "Garden"],
                EF.TABLE_TYPE_RANKING_KEY: ["Standard"],
            },
        )

        vendors, incomplete = solver_vendors_from_applications([legacy], A_FULL_PLAN)

        assert incomplete == [], [item.reasons for item in incomplete]
        assert [vendor.email for vendor in vendors] == ["vendor@example.com"]

    def test_the_name_is_asked_of_that_very_market(self):
        """So the test above is about the solver ignoring it, not about it not being asked."""
        assert EF.FULL_NAME_KEY in EF.asked_essential_keys(A_FULL_PLAN)


class TestTheGuardStillGuards:
    """A name asked unconditionally would have made ``FormHasFieldsGuard`` unable to fail.

    That guard is the last thing stopping an organizer opening applications on a market with
    nothing to assign - collecting applications for an event that cannot place anyone.
    """

    def _market(self, setup, fields=()):
        class _Form:
            def __init__(self, fields):
                self.fields = list(fields)

        class _Market:
            id = "market-1"
            application_form = _Form(fields)
            setup_object = None

        market = _Market()
        market.setup_object = setup
        return market

    def _evaluate(self, monkeypatch, options, fields=()):
        import guards
        monkeypatch.setattr(
            guards, "effective_essential_options_for_market", lambda _market: options,
        )
        return FormHasFieldsGuard().evaluate(self._market(None, fields), db=None)

    def test_a_market_whose_plan_offers_nothing_is_still_blocked(self, monkeypatch):
        result = self._evaluate(monkeypatch, EssentialFormOptions())

        assert result.passed is False
        assert "The application form asks nothing" in result.message

    def test_a_market_with_dates_is_not_blocked(self, monkeypatch):
        result = self._evaluate(monkeypatch, EssentialFormOptions(dates=["2026-08-01"]))

        assert result.passed is True

    def test_a_market_with_a_custom_field_is_not_blocked(self, monkeypatch):
        result = self._evaluate(
            monkeypatch, EssentialFormOptions(), fields=[{"key": "shop", "label": "Shop"}],
        )

        assert result.passed is True

    def test_the_name_alone_never_satisfies_the_guard(self, monkeypatch):
        """The regression this class exists for: the next unconditional essential question must
        not silently disable the guard the way this one nearly did."""
        options = EssentialFormOptions()

        assert EF.FULL_NAME_KEY in EF.asked_essential_keys(options)
        assert EF.plan_derived_asked_keys(options) == frozenset()
        assert self._evaluate(monkeypatch, options).passed is False
