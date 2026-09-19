"""Tier preference is answered per date, because tier sets the price.

E01/F05, decided by wayfinder ticket 02.

A real form asks tiers per day - "for each day, choose all table tiers you would like to be
considered for" - and promises, in writing, "you will be given the highest tier available among the
selections made" *for that day*. The contract stored one flat set for the whole application, so the
cheap fix would have been to union the days together.

The union was rejected because ``accepts_tier`` is a HARD filter and a tier sets what the vendor
pays. Under a union, someone who offered Gold on Monday and Bronze on Friday can be placed at Gold
on Friday and charged for it, or at Bronze on Monday when Monday was the day they wanted. That is
the behaviour these tests pin.

Availability stays its own answer: "who could come on Tuesday" is a planning question that survives
a market having no tiers at all, which ``asked_essential_keys`` already treats as legitimate.
Validation refuses a ticked date with no tiers, so the two can never disagree.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import essential_fields as EF  # noqa: E402
from datatypes import EssentialFormOptions  # noqa: E402

MON, TUE, FRI = "2025-11-17", "2025-11-18", "2025-11-21"


def _options(**overrides):
    base = dict(dates=[MON, TUE, FRI], sections=[], tiers=["Gold", "Silver", "Bronze"],
                table_types=[])
    base.update(overrides)
    return EssentialFormOptions(**base)


def _answers(tier_preference, dates=(MON, TUE, FRI)):
    return {
        EF.FULL_NAME_KEY: "Ana Rivera",
        EF.AVAILABLE_DATES_KEY: list(dates),
        EF.MAX_DATES_KEY: 3,
        EF.TABLE_CHOICE_KEY: "full",
        EF.TIER_PREFERENCE_KEY: tier_preference,
    }


class TestTheStoredShape:
    def test_a_per_date_answer_is_accepted_and_stored_per_date(self):
        error, stored = EF.validated_essential_answers(
            _answers({MON: ["Gold"], TUE: ["Silver"], FRI: ["Bronze"]}), _options(),
        )

        assert error is None, error
        assert stored[EF.TIER_PREFERENCE_KEY] == {
            MON: ["Gold"], TUE: ["Silver"], FRI: ["Bronze"],
        }

    def test_a_date_the_applicant_cannot_attend_carries_no_tiers(self):
        error, stored = EF.validated_essential_answers(
            _answers({MON: ["Gold"]}, dates=[MON]), _options(),
        )

        assert error is None, error
        assert stored[EF.TIER_PREFERENCE_KEY] == {MON: ["Gold"]}

    def test_a_tier_the_market_does_not_offer_is_refused(self):
        error, _ = EF.validated_essential_answers(
            _answers({MON: ["Platinum"]}, dates=[MON]), _options(),
        )

        assert error is not None
        assert "Platinum" in error


class TestAvailabilityAndTierMustAgree:
    """Two answers, one truth. Neither may contradict the other."""

    def test_an_available_date_with_no_tiers_is_refused(self):
        error, _ = EF.validated_essential_answers(
            _answers({MON: ["Gold"], TUE: [], FRI: ["Bronze"]}), _options(),
        )

        assert error is not None
        assert TUE in error

    def test_a_tier_answer_for_a_date_not_available_is_refused(self):
        error, _ = EF.validated_essential_answers(
            _answers({MON: ["Gold"], TUE: ["Silver"]}, dates=[MON]), _options(),
        )

        assert error is not None
        assert TUE in error

    def test_a_missing_date_entirely_is_refused(self):
        error, _ = EF.validated_essential_answers(
            _answers({MON: ["Gold"]}, dates=[MON, TUE]), _options(),
        )

        assert error is not None
        assert TUE in error


class TestAMarketWithNoTiers:
    """The tier question is not asked, so it must not become a way to refuse an application."""

    def test_no_tiers_offered_means_no_tier_answer_required(self):
        options = _options(tiers=[])
        answers = _answers({}, dates=[MON])
        del answers[EF.TIER_PREFERENCE_KEY]

        error, stored = EF.validated_essential_answers(answers, options)

        assert error is None, error
        assert stored[EF.TIER_PREFERENCE_KEY] == {}

    def test_availability_is_still_asked(self):
        assert EF.AVAILABLE_DATES_KEY in EF.asked_essential_keys(_options(tiers=[]))


class TestTheSolverFiltersPerDate:
    """The behaviour the whole change exists for: nobody is priced into a tier they refused."""

    def _vendor(self, tier_preference, dates=(MON, FRI)):
        from assignment.vendor_input import _solver_vendor
        from datatypes import Application, ApplicationStatus

        application = Application(
            market_id="m1", applicant_email="v@example.com",
            form_data={
                EF.AVAILABLE_DATES_KEY: list(dates),
                EF.MAX_DATES_KEY: 2,
                EF.TABLE_CHOICE_KEY: "full",
                EF.TIER_PREFERENCE_KEY: tier_preference,
            },
            status=ApplicationStatus.REVIEWER_APPROVED,
        )
        options = EssentialFormOptions(
            dates=[MON, FRI], sections=[], tiers=["Gold", "Bronze"], table_types=[],
        )
        vendor, incomplete = _solver_vendor(application, options)
        assert incomplete is None, incomplete
        return vendor

    def test_a_tier_offered_on_one_day_is_not_accepted_on_another(self):
        """Gold on Monday, Bronze on Friday: Gold on FRIDAY must be refused."""
        vendor = self._vendor({MON: ["Gold"], FRI: ["Bronze"]})

        assert vendor.accepts_tier_on(MON, "Gold")
        assert not vendor.accepts_tier_on(FRI, "Gold"), (
            "a union would place this vendor at Gold on Friday and charge them for it"
        )
        assert vendor.accepts_tier_on(FRI, "Bronze")
        assert not vendor.accepts_tier_on(MON, "Bronze"), (
            "a union would place this vendor at Bronze on their chosen day"
        )

    def test_a_market_with_no_tiers_constrains_nothing(self):
        vendor = self._vendor({MON: ["Gold"], FRI: ["Bronze"]})

        assert vendor.accepts_tier_on(MON, None), "a table with no tier constrains nothing"

    def test_a_date_the_vendor_never_answered_accepts_no_tier(self):
        vendor = self._vendor({MON: ["Gold"], FRI: ["Bronze"]})

        assert not vendor.accepts_tier_on("2099-01-01", "Gold")
