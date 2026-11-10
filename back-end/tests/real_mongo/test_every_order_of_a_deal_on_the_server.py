"""A change of reviewers and an arrival are dealt right in every order, with the server matching
(E38/F07, ADR 0020).

``test_every_order_of_a_deal.py`` lands the other deal before every step the first one takes, and
checks after each that the shares are even, the turn is where the next arrival expects it, and
nothing is left waiting or held. Its cases are imported here, not copied, and run over a world
whose markets, applications and history are the real collections: its ``Counted`` wrapper steps
over the server's own calls, so every lease, mark and deal is matched by MongoDB, not a fake.
"""
from types import SimpleNamespace

import pytest

from market_documents import MARKETS_COLLECTION
from test_choosing_reviewers_deals_the_open_applications import (
    MARKET, the_market, the_people_sign_in,
)
from test_every_order_of_a_deal import (  # noqa: F401  (collected here, over this world)
    TestAChangeAtEveryStepOfAnArrival, TestAnArrivalAtEveryStepOfAChange, TestEveryLetGoLooksAgain,
    TestTheMarketsHold, TestTwoArrivalsAtOnce,
)

import api.markets as MarketsApi
import review_team as ReviewTeam


@pytest.fixture
def world(monkeypatch, real_db, applications, market_records):
    """The hermetic file's world, on the server: ``markets`` is the collection the back end is
    bound to, and ``market()`` stores the market afresh in it."""
    markets = real_db[MARKETS_COLLECTION]
    assert MarketsApi.markets_collection.full_name == ReviewTeam.markets_collection.full_name == (
        markets.full_name)

    def market(phase=None, **overrides):
        markets.delete_many({"id": MARKET})
        markets.insert_one(the_market(**({"phase": phase} if phase else {}), **overrides))
        return markets

    the_people_sign_in(monkeypatch)
    world = SimpleNamespace(
        market=market, applications=applications, history=market_records.history, markets=markets)
    market()
    return world
