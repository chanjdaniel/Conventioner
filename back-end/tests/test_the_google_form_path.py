"""The Google Form path enters Review by its first import (E38/F04/S01).

An organizer on this path already holds their Google Form's responses when they leave draft, so the
import is the collection: the market enters the stage, shown as Review, only once its responses are
imported. The move from draft waits on an import (``ResponsesImportedGuard``), whose fix is the
import itself, and the import takes the move once its rows are written.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applications as ApplicationsApi  # noqa: E402
from conftest import complete_setup  # noqa: E402
from datatypes import IntakeMode, Market, MarketPhase, MarketRole, phase_label  # noqa: E402
from guards import evaluate_transition, transition_verdicts  # noqa: E402


def _market(phase: MarketPhase, intake: IntakeMode = IntakeMode.CSV) -> Market:
    return Market(
        id="market-1",
        name="Test Market",
        creation_date="2026-01-01",
        roles={"user-1": MarketRole.OWNER},
        modification_list=[],
        assignment_object={},
        setup_object=complete_setup(),
        application_form={"fields": [{"key": "name", "label": "Name", "type": "text"}]},
        phase=phase,
        intake_mode=intake,
    )


@pytest.fixture
def applications(monkeypatch):
    def _set(n):
        monkeypatch.setattr(ApplicationsApi, "count_applications_for_market", lambda _id: n)
        monkeypatch.setattr(
            ApplicationsApi, "count_applications_with_any_status", lambda _id, _statuses: 0,
        )
    _set(0)
    return _set


class TestTheMovesOnThePath:
    def test_a_draft_moves_on_into_the_stage_and_nowhere_else(self, applications):
        verdicts = transition_verdicts(_market(MarketPhase.DRAFT), None)

        assert set(verdicts) == {"applications", "archived"}

    def test_the_stage_goes_back_to_draft_or_on_to_assignment(self, applications):
        verdicts = transition_verdicts(_market(MarketPhase.APPLICATIONS), None)

        assert set(verdicts) == {"draft", "assignment", "archived"}

    def test_the_stage_is_called_review_on_this_path_and_applications_on_the_other(self):
        assert phase_label(MarketPhase.APPLICATIONS, IntakeMode.CSV) == "Review"
        assert phase_label(MarketPhase.APPLICATIONS, IntakeMode.FORM) == "Applications"
        assert phase_label(MarketPhase.APPLICATIONS) == "Applications"


class TestReviewWaitsOnAnImport:
    def test_entering_review_is_refused_while_nothing_has_been_imported(self, applications):
        [blocker] = evaluate_transition(_market(MarketPhase.DRAFT), "applications", None)

        assert blocker.id == "responses_imported"
        assert "Import your Google Form's responses" in blocker.message
        assert blocker.resolution_link == "import"
        assert blocker.resolution_label == "Import responses"

    def test_one_import_is_enough(self, applications):
        applications(3)

        assert evaluate_transition(_market(MarketPhase.DRAFT), "applications", None) == []

    def test_the_setup_is_asked_for_first(self, applications):
        """The rail's fix is the move's first blocker, so Market Setup is offered before the import."""
        market = _market(MarketPhase.DRAFT).model_copy(update={"setup_object": None})

        blockers = evaluate_transition(market, "applications", None)

        assert blockers[0].id == "setup_has_dates"
        assert blockers[-1].id == "responses_imported"

    def test_the_first_import_judges_the_move_less_what_it_writes(self, applications):
        blockers = evaluate_transition(
            _market(MarketPhase.DRAFT), "applications", None, leaving_out=("responses_imported",),
        )

        assert blockers == []

    def test_a_form_market_is_not_asked_to_import(self, applications):
        blockers = evaluate_transition(
            _market(MarketPhase.DRAFT, IntakeMode.FORM), "applications", None,
        )

        assert blockers == []
