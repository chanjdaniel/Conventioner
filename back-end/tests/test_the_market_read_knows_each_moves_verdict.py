"""The market read serves each move's verdict, so the rail says no before the click (E31/F02/S01).

The walk found "Open applications" offered on an empty draft, "Publish market" before any run and
"Reopen for editing" with applications present - each enabled, and each refused only after the
click. The same guards the transition endpoint runs are judged on the read, for every move open
from the market's phase, so a screen can disable a move and name its blocker before anyone tries.
"""
from dataclasses import asdict

import pytest

import api.markets as MarketsApi
import guards
import test_the_lock_rides_on_the_market as Read  # noqa: F401 - the `serve` fixture's market shape
from conftest import COMPLETE_PLAN, FakeMarketsCollection
from datatypes import MarketPhase
from guards import evaluate_transition, moves_from, transition_verdicts
from market_documents import market_from_document

serve = Read.serve


@pytest.mark.parametrize("phase", list(MarketPhase))
def test_every_move_from_a_phase_is_judged_as_the_endpoint_judges_it(phase, applications):
    market = market_from_document({**Read._stored(phase), "setupObject": COMPLETE_PLAN})

    verdicts = transition_verdicts(market, None)

    assert set(verdicts) == set(moves_from(phase.value))
    for to_phase, blockers in verdicts.items():
        assert [asdict(b) for b in blockers] == \
            [asdict(b) for b in evaluate_transition(market, to_phase, None)]


def test_the_read_serves_them_camel_cased(serve):
    market = serve(MarketPhase.DRAFT)

    blockers = market["transitionBlockers"]["applications"]
    assert blockers, "an empty draft cannot open applications"
    assert {"id", "passed", "message", "resolutionLink", "resolutionAction"} <= set(blockers[0])
    assert market["transitionBlockers"]["archived"] == []


def test_a_move_that_would_succeed_has_no_blockers(serve):
    market = serve(MarketPhase.APPLICATIONS, intake_mode="form")

    assert market["transitionBlockers"]["draft"] == []


def test_a_google_form_draft_waits_on_its_import(serve):
    """Its first import is its way into Review (E38/F04/S01), so the move names the import as its fix."""
    moves = serve(MarketPhase.DRAFT)["transitionBlockers"]

    assert moves["applications"][-1]["id"] == "responses_imported"
    assert moves["applications"][-1]["resolutionLink"] == "import"
    # With the row of the table the import takes, so the rail offers it only to whom that row lets
    # import (T142).
    assert moves["applications"][-1]["resolutionAction"] == "import-applications"


def test_the_read_serves_whether_applications_are_stopped(serve):
    market = serve(MarketPhase.APPLICATIONS, intake_mode="form")

    assert market["applicationsStopped"] is False
    assert market["applicationsStopReason"] is None
    assert serve(MarketPhase.APPLICATIONS)["applicationsStopReason"]


def test_the_read_serves_the_review_setups_two_nones(serve, monkeypatch):
    """Absent, each reads undecided (T206): no migration, a draft decides them on Review setup."""
    market = serve(MarketPhase.DRAFT, intake_mode="form")

    assert market["nothingLeadsTheCard"] is False
    assert market["noAutomaticRejections"] is False

    decided = {**Read._stored(MarketPhase.DRAFT, "form"),
               "nothingLeadsTheCard": True, "noAutomaticRejections": True}
    monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(decided))
    market = MarketsApi.get_market_for_user(Read.USER_EMAIL, "m1")

    assert market["nothingLeadsTheCard"] is True
    assert market["noAutomaticRejections"] is True
