"""Leaving draft is finalizing, and the transition records when it happened (E18/F03/S01).

`ApplicationForm.published_at` was designed for this, threaded through the market API and read by
two front-end components - and nothing ever assigned it, so it was null on every market.
"""
import pytest

import api.markets as MarketsApi
from datatypes import MarketPhase


def _doc(**overrides):
    base = {"id": "m-1", "name": "A Market", "phase": MarketPhase.DRAFT.value}
    base.update(overrides)
    return base


class TestWhatTheTransitionStamps:
    def test_opening_applications_from_draft_stamps_the_form(self):
        update = MarketsApi.finalization_update(
            MarketPhase.DRAFT.value, MarketPhase.APPLICATIONS_OPEN.value, _doc()
        )

        assert list(update) == ["applicationForm"]
        assert update["applicationForm"]["publishedAt"]

    def test_it_stamps_onto_an_existing_form_without_disturbing_its_fields(self):
        document = _doc(applicationForm={"fields": [{"key": "shop", "label": "Shop", "type": "text"}]})

        update = MarketsApi.finalization_update(
            MarketPhase.DRAFT.value, MarketPhase.APPLICATIONS_OPEN.value, document
        )

        assert list(update) == ["applicationForm.publishedAt"]
        assert update["applicationForm.publishedAt"]

    def test_a_market_with_no_stored_form_still_gets_a_stamp(self):
        # The essential questions ARE a form, so a market can open applications with no custom
        # fields and no stored form object at all. It is still finalized.
        update = MarketsApi.finalization_update(
            MarketPhase.DRAFT.value, MarketPhase.APPLICATIONS_OPEN.value, _doc(applicationForm=None)
        )

        assert update["applicationForm"]["fields"] == []
        assert update["applicationForm"]["publishedAt"]

    def test_returning_to_draft_clears_the_stamp(self):
        document = _doc(
            phase=MarketPhase.APPLICATIONS_OPEN.value,
            applicationForm={"fields": [], "publishedAt": "2026-09-01T00:00:00+00:00"},
        )

        update = MarketsApi.finalization_update(
            MarketPhase.APPLICATIONS_OPEN.value, MarketPhase.DRAFT.value, document
        )

        assert update == {"applicationForm.publishedAt": None}

    def test_publishing_straight_from_draft_does_not_stamp(self):
        # This is what keeps the field from being a restatement of `phase != draft`: a market
        # published by this route never opened its form to anybody.
        update = MarketsApi.finalization_update(
            MarketPhase.DRAFT.value, MarketPhase.ARCHIVED.value, _doc()
        )

        assert update == {}

    @pytest.mark.parametrize(
        "from_phase,to_phase",
        [
            (MarketPhase.APPLICATIONS_OPEN.value, MarketPhase.APPLICATIONS_CLOSED.value),
            (MarketPhase.REVIEW.value, MarketPhase.ASSIGNMENT.value),
            (MarketPhase.ASSIGNMENT.value, MarketPhase.MARKET_DAYS.value),
            (MarketPhase.MARKET_DAYS.value, MarketPhase.ARCHIVED.value),
        ],
    )
    def test_every_other_move_leaves_the_stamp_alone(self, from_phase, to_phase):
        document = _doc(phase=from_phase, applicationForm={"fields": [], "publishedAt": "2026-09-01T00:00:00+00:00"})

        assert MarketsApi.finalization_update(from_phase, to_phase, document) == {}

    def test_returning_to_draft_with_no_form_writes_nothing(self):
        update = MarketsApi.finalization_update(
            MarketPhase.APPLICATIONS_OPEN.value, MarketPhase.DRAFT.value, _doc(applicationForm=None)
        )

        assert update == {}
