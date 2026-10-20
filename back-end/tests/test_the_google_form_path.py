"""The Google Form path reads Plan, Import, Review (E32/F02/S01).

An organizer on this path already holds their Google Form's responses when they leave draft, so
"Start Collecting" and "Done Collecting" asked them to say things that were not so. The server's
phases do not change: the path steps through ``applications_closed`` rather than stopping in it,
so Begin Review takes a market from importing to review in one move, every hop's guards judged
before the first step - and refused while nothing has been imported.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.applications as ApplicationsApi  # noqa: E402
from datatypes import IntakeMode, Market, MarketPhase, MarketRole  # noqa: E402
from guards import (  # noqa: E402
    VALID_TRANSITIONS,
    evaluate_transition,
    path_moves,
    transition_verdicts,
)


def _market(phase: MarketPhase, intake: IntakeMode = IntakeMode.CSV) -> Market:
    return Market(
        id="market-1",
        name="Test Market",
        creation_date="2026-01-01",
        roles={"user-1": MarketRole.OWNER},
        modification_list=[],
        assignment_object={},
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
    def test_importing_moves_on_to_review_through_the_closed_phase(self):
        moves = path_moves(_market(MarketPhase.APPLICATIONS_OPEN))

        assert moves == {
            "draft": ["draft"],
            "review": ["applications_closed", "review"],
            "archived": ["archived"],
        }

    def test_review_goes_back_to_importing_through_it_too(self):
        moves = path_moves(_market(MarketPhase.REVIEW))

        assert moves["applications_open"] == ["applications_closed", "applications_open"]
        assert "applications_closed" not in moves
        assert moves["assignment"] == ["assignment"]

    def test_a_form_market_stops_in_every_phase(self):
        for phase in MarketPhase:
            moves = path_moves(_market(phase, IntakeMode.FORM))

            assert moves == {
                to: [to] for frm, to in VALID_TRANSITIONS if frm == phase.value
            }

    def test_a_google_form_market_already_in_the_closed_phase_still_has_its_ways_out(self):
        """A market moved there before the path stepped through it is not stranded."""
        moves = path_moves(_market(MarketPhase.APPLICATIONS_CLOSED))

        assert moves["review"] == ["review"]
        assert moves["applications_open"] == ["applications_open"]

    def test_the_market_read_offers_the_paths_moves_and_no_others(self, applications):
        verdicts = transition_verdicts(_market(MarketPhase.APPLICATIONS_OPEN), None)

        assert set(verdicts) == {"draft", "review", "archived"}


class TestReviewWaitsOnAnImport:
    def test_begin_review_is_refused_while_nothing_has_been_imported(self, applications):
        [blocker] = evaluate_transition(_market(MarketPhase.APPLICATIONS_OPEN), "review", None)

        assert blocker.id == "responses_imported"
        assert "Import your Google Form's responses" in blocker.message
        assert blocker.resolution_link == "import"
        assert blocker.resolution_label == "Import responses"

    def test_one_import_is_enough(self, applications):
        applications(3)

        assert evaluate_transition(_market(MarketPhase.APPLICATIONS_OPEN), "review", None) == []

    def test_it_holds_on_the_last_step_alone_too(self, applications):
        """A market already in the closed phase meets the same rule on the edge it takes."""
        blockers = evaluate_transition(_market(MarketPhase.APPLICATIONS_CLOSED), "review", None)

        assert [b.id for b in blockers] == ["responses_imported"]

    def test_a_form_market_is_not_asked_to_import(self, applications):
        blockers = evaluate_transition(
            _market(MarketPhase.APPLICATIONS_CLOSED, IntakeMode.FORM), "review", None,
        )

        assert blockers == []
