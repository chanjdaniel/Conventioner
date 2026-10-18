"""The market read serves each move's verdict, so the rail says no before the click (E31/F02/S01).

The walk found "Open Applications" offered on an empty draft, "Publish Market" before any run and
"Reopen for Editing" with applications present - each enabled, and each refused only after the
click. The same guards the transition endpoint runs are judged on the read, for every move open
from the market's phase, so a screen can disable a move and name its blocker before anyone tries.
"""
from dataclasses import asdict

import pytest

import guards
import test_the_lock_rides_on_the_market as Read  # noqa: F401 - the `serve` fixture's market shape
from conftest import COMPLETE_PLAN
from datatypes import MarketPhase
from guards import VALID_TRANSITIONS, evaluate_transition, transition_verdicts
from market_documents import market_from_document

serve = Read.serve


def _moves_from(phase: MarketPhase):
    return {to for frm, to in VALID_TRANSITIONS if frm == phase.value}


@pytest.mark.parametrize("phase", list(MarketPhase))
def test_every_move_from_a_phase_is_judged_as_the_endpoint_judges_it(phase, applications):
    market = market_from_document({**Read._stored(phase), "setupObject": COMPLETE_PLAN})

    verdicts = transition_verdicts(market, None)

    assert set(verdicts) == _moves_from(phase)
    for to_phase, blockers in verdicts.items():
        assert [asdict(b) for b in blockers] == \
            [asdict(b) for b in evaluate_transition(market, to_phase, None)]


def test_the_read_serves_them_camel_cased(serve):
    market = serve(MarketPhase.DRAFT)

    blockers = market["transitionBlockers"]["applications_open"]
    assert blockers, "an empty draft cannot open applications"
    assert {"id", "passed", "message", "resolutionLink"} <= set(blockers[0])
    assert market["transitionBlockers"]["archived"] == []


def test_a_move_that_would_succeed_has_no_blockers(serve):
    assert serve(MarketPhase.APPLICATIONS_OPEN)["transitionBlockers"]["applications_closed"] == []
