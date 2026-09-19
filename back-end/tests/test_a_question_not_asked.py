"""A market may declare a required ranking "not asked", and only a ranking.

E01/F06, decided by wayfinder ticket 03.

The blocker: tier is a property of a section, so a market offering Gold/Silver/Bronze needs at least
three sections, and ``asks_ranking`` makes section preference required from two sections up. A real
Google Form that never mentioned sections therefore cannot answer a question the market insists on,
and the import is refused outright - Preview never enables.

The limit is the whole point. A ranking is a *soft preference*: the solver gives a vendor their
best-ranked section still open and never excludes anyone for it, so a uniform default changes
nothing but the tie-break. Available dates, tier preference and table choice are not like that - a
default there invents a commitment the applicant never made and the solver then acts on it, placing
someone on a day they cannot attend or at a price they refused.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import essential_fields as EF  # noqa: E402
from datatypes import EssentialFormOptions  # noqa: E402


def _options(**overrides):
    base = dict(
        dates=["2025-11-17", "2025-11-18"],
        sections=["Front Row", "Middle", "Back Wall"],
        tiers=["Gold", "Silver", "Bronze"],
        table_types=[],
    )
    base.update(overrides)
    return EssentialFormOptions(**base)


class TestDeclaringAQuestionNotAsked:
    def test_a_market_asks_section_ranking_by_default(self):
        assert EF.SECTION_RANKING_KEY in EF.asked_essential_keys(_options())

    def test_declaring_it_unasked_removes_it(self):
        options = _options(unasked=[EF.SECTION_RANKING_KEY])

        assert EF.SECTION_RANKING_KEY not in EF.asked_essential_keys(options)

    def test_nothing_else_is_disturbed(self):
        """The other questions this market asks are untouched."""
        asked = EF.asked_essential_keys(_options(unasked=[EF.SECTION_RANKING_KEY]))

        assert EF.AVAILABLE_DATES_KEY in asked
        assert EF.TIER_PREFERENCE_KEY in asked
        assert EF.TABLE_CHOICE_KEY in asked

    def test_declaring_a_question_the_market_never_asked_is_harmless(self):
        """Nothing to remove; it must not raise or change the rest."""
        options = _options(table_types=[], unasked=[EF.TABLE_TYPE_RANKING_KEY])

        assert EF.asked_essential_keys(options) == EF.asked_essential_keys(_options())


class TestOnlyARankingMayBeDeclared:
    """The limit that keeps a default from inventing a commitment."""

    @pytest.mark.parametrize("key", [
        EF.SECTION_RANKING_KEY,
        EF.TABLE_TYPE_RANKING_KEY,
    ])
    def test_a_ranking_may_be(self, key):
        assert EF.unaskable_essential_error([key]) is None

    @pytest.mark.parametrize("key", [
        EF.AVAILABLE_DATES_KEY,
        EF.TIER_PREFERENCE_KEY,
        EF.TABLE_CHOICE_KEY,
        EF.MAX_DATES_KEY,
    ])
    def test_a_hard_answer_may_not_be(self, key):
        error = EF.unaskable_essential_error([key])

        assert error is not None
        assert key in error

    def test_an_unknown_key_is_refused(self):
        assert EF.unaskable_essential_error(["essential_favourite_colour"]) is not None

    def test_nothing_declared_is_fine(self):
        assert EF.unaskable_essential_error([]) is None
        assert EF.unaskable_essential_error(None) is None

    def test_the_solver_never_filters_on_what_may_be_declared(self):
        """The property that makes the limit correct, asserted rather than trusted to a comment.

        Every declarable key is a ranking, and a ranking is the only kind of essential answer the
        solver treats as a preference rather than a constraint.
        """
        assert set(EF.UNASKABLE_ESSENTIAL_KEYS) == {
            EF.SECTION_RANKING_KEY,
            EF.TABLE_TYPE_RANKING_KEY,
        }


ANSWERS_WITHOUT_A_SECTION_RANKING = {
    EF.FULL_NAME_KEY: "Ana Rivera",
    EF.AVAILABLE_DATES_KEY: ["2025-11-17"],
    EF.MAX_DATES_KEY: 1,
    # Tier is answered per date (E01/F05).
    EF.TIER_PREFERENCE_KEY: {"2025-11-17": ["Gold"]},
    EF.TABLE_CHOICE_KEY: "full",
}


class TestAnApplicantIsNotAskedEither:
    """Requiredness has one statement, so the applicant validator follows automatically.

    ``validated_essential_answers`` returns ``(error_message, stored)`` - a message, not a map - so
    these assert on the accept/refuse outcome and on what gets stored, which is the behaviour that
    matters. Asserting a key against the message string would pass whether or not it did anything.
    """

    def test_the_answer_is_accepted_when_the_question_is_not_asked(self):
        options = _options(unasked=[EF.SECTION_RANKING_KEY])

        error, stored = EF.validated_essential_answers(
            dict(ANSWERS_WITHOUT_A_SECTION_RANKING), options,
        )

        assert error is None, error
        assert stored[EF.SECTION_RANKING_KEY] == [], (
            "an unasked ranking stores its empty value, the same as any question with nothing "
            "to offer"
        )

    def test_the_same_answer_is_refused_when_it_is_asked(self):
        error, _stored = EF.validated_essential_answers(
            dict(ANSWERS_WITHOUT_A_SECTION_RANKING), _options(),
        )

        assert error is not None
        assert EF.SECTION_RANKING_LABEL in error

    def test_a_hard_question_is_still_required_even_beside_an_unasked_one(self):
        """Declaring one question unasked must not relax the others."""
        options = _options(unasked=[EF.SECTION_RANKING_KEY])
        answers = dict(ANSWERS_WITHOUT_A_SECTION_RANKING)
        del answers[EF.TIER_PREFERENCE_KEY]

        error, _stored = EF.validated_essential_answers(answers, options)

        assert error is not None
        assert EF.TIER_PREFERENCE_LABEL in error


class TestTheBlockerItClosed:
    """The reason this exists: a real form that never mentioned sections could not be imported."""

    def test_section_ranking_stops_being_an_import_target(self):
        """``import_targets`` offers only what the market asks, so declaring it drops the target."""
        from csv_import import import_targets

        market_doc = {
            "id": "m1",
            "setupObject": {
                "marketDates": [{"date": "2025-11-17"}],
                "tiers": [{"id": 1, "name": "Gold"}, {"id": 2, "name": "Silver"}],
                "sections": [
                    {"name": "Front Row", "count": 10},
                    {"name": "Middle", "count": 20},
                ],
                "locations": [], "priority": [],
            },
            "applicationForm": {"fields": [], "unaskedEssentials": [EF.SECTION_RANKING_KEY]},
        }

        keys = {t.key for t in import_targets(market_doc)}

        assert EF.SECTION_RANKING_KEY not in keys
        assert EF.AVAILABLE_DATES_KEY in keys, "the questions it DOES ask are untouched"
        assert EF.TIER_PREFERENCE_KEY in keys

    def test_without_the_declaration_it_is_still_required(self):
        from csv_import import import_targets

        market_doc = {
            "id": "m1",
            "setupObject": {
                "marketDates": [{"date": "2025-11-17"}],
                "tiers": [{"id": 1, "name": "Gold"}],
                "sections": [
                    {"name": "Front Row", "count": 10},
                    {"name": "Middle", "count": 20},
                ],
                "locations": [], "priority": [],
            },
            "applicationForm": {"fields": []},
        }

        required = {t.key for t in import_targets(market_doc) if t.required}

        assert EF.SECTION_RANKING_KEY in required
