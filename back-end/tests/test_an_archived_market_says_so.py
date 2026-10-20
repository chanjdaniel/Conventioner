"""An archived market's read-only screens give the archived reason (E30/F01/S02).

The walk found an archived market's form saying it "can only be edited while the market is in
draft phase", and its assignment rules sending the organizer to change a placement - neither of
which an archived market can do. Archived is the reason, so it is the one given.
"""
import pytest

import api.markets as MarketsApi
from datatypes import Market, MarketPhase


def _market(phase):
    return Market(id="market-1", name="Test Market", creation_date="2026-01-01",
                  roles={"user-1": "owner"}, modification_list=[],
                  assignment_object={"assignment_date": "", "vendor_assignments": []}, phase=phase)


def test_an_archived_markets_form_is_locked_because_it_is_archived():
    assert MarketsApi.application_form_lock_reason(_market(MarketPhase.ARCHIVED)) == \
        MarketsApi.ARCHIVED_REFUSAL


def test_an_archived_markets_rules_are_settled_because_it_is_archived():
    assert MarketsApi.assignment_rules_lock_reason(_market(MarketPhase.ARCHIVED)) == \
        MarketsApi.ARCHIVED_REFUSAL


@pytest.mark.parametrize("phase", [MarketPhase.OFFERS, MarketPhase.MARKET_DAYS])
def test_a_running_markets_rules_still_point_at_a_single_placement(phase):
    assert MarketsApi.assignment_rules_lock_reason(_market(phase)) == \
        MarketsApi.ASSIGNMENT_RULES_SETTLED
