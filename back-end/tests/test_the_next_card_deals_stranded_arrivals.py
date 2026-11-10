"""The next card deals the applications a dead deal left waiting (E38/F07, ADR 0020).

An arrival that finds the market held marks its application as arriving and leaves it to the deal
holding the market, which deals it as it lets go. A holder the host ended never lets go: its lease
runs out, and nothing looked again until some later arrival, so the last applications before a
quiet spell sat with no reviewer, and a chosen reviewer on "mine only" was told their share was
empty. ``review/next`` now deals what waits before it claims, recorded under the write each
application arrived by, never the reviewer who asked. No read deals: the applications list stays
a pure read.
"""
from datetime import datetime, timedelta, timezone

import pytest

from test_choosing_reviewers_deals_the_open_applications import (  # noqa: F401  (the fixture)
    ANA, BEN, CAT, MARKET, VIEWER, _application, _choose, _client, world,
)

import api.applications as ApplicationsApi
import api.markets as MarketsApi
import history as History
import review_team as ReviewTeam
from datatypes import MarketPhase

DEAD_DEAL = "a-deal-the-host-ended"


def _lease(world, *, seconds):
    """The lease a deal took and never let go, running out ``seconds`` from now."""
    until = datetime.now(timezone.utc) + timedelta(seconds=seconds)
    world.markets.doc["reviewTeam"]["dealing"] = {"by": DEAD_DEAL, "until": until.isoformat()}


def _arrive(world, name, day):
    """An application arrives open, as an applicant's save deals it."""
    world.applications.documents.append(_application(name, day))
    ReviewTeam.deal_arrivals(
        MarketsApi.market_from_document(world.markets.doc), f"{name}@vendor.test", History.APPLY,
        only=f"app-{name}")


@pytest.fixture
def stranded(world):
    """Ana, Ben and Cat chosen over the seven open applications (the turn at 7), and every one of
    them decided; then x and y arrive while a deal holds the market, and that deal dies: its lease
    runs out with x and y still waiting, and nobody arrives after."""
    assert _choose([ANA, BEN, CAT]).status_code == 200
    for doc in world.applications.documents:
        if doc["status"] in ("open", "under_review"):
            doc.update(status="reviewer_approved", verdict_at="2026-10-21T00:00:00+00:00")
    _lease(world, seconds=30)
    _arrive(world, "x", 21)
    _arrive(world, "y", 22)
    assert _waiting(world) == ["app-x", "app-y"]
    _lease(world, seconds=-1)
    world.history.documents.clear()
    return world


def _waiting(world):
    return [doc["id"] for doc in world.applications.documents
            if doc.get(ApplicationsApi.ARRIVING_FIELD)]


def _reviewer(world, name):
    doc = next(d for d in world.applications.documents if d["id"] == f"app-{name}")
    return (doc.get("reviewer") or {}).get("email")


def _next(who, mine_only=True):
    response = _client(who).post(
        f"/markets/{MARKET}/review/next", json={"includeFollowUps": False, "mineOnly": mine_only})
    assert response.status_code == 200, response.get_json()
    application = response.get_json()["application"]
    return application["id"].removeprefix("app-") if application else None


def _dealt_entries(world):
    return [e for e in world.history.documents if e["kind"] == History.DEALT]


class TestAChosenReviewersNextCard:
    def test_q24_a_deal_killed_while_holding_the_market(self, stranded):
        # The turn stood at 7: x to Ben, y to Cat.
        assert _next(BEN) == "x"

        assert (_reviewer(stranded, "x"), _reviewer(stranded, "y")) == (BEN, CAT)
        assert _waiting(stranded) == []
        assert stranded.markets.doc["reviewTeam"]["turn"] == 9
        assert "dealing" not in stranded.markets.doc["reviewTeam"]
        assert _next(CAT) == "y"

    def test_the_card_says_how_many_its_deal_dealt(self, stranded):
        response = _client(BEN).post(f"/markets/{MARKET}/review/next", json={"mineOnly": True})

        # x to Ben and y to Cat: the screen reads its list again to show Cat's.
        assert response.get_json()["dealt"] == 2
        again = _client(CAT).post(f"/markets/{MARKET}/review/next", json={"mineOnly": True})
        assert again.get_json()["dealt"] == 0

    def test_the_deal_is_recorded_as_each_arrivals_own_write(self, stranded):
        _next(ANA)

        entries = _dealt_entries(stranded)
        assert [(e["actor"], e["action"], e["subject"]) for e in entries] == [
            ("x@vendor.test", History.APPLY, {"application_ids": ["app-x"]}),
            ("y@vendor.test", History.APPLY, {"application_ids": ["app-y"]}),
        ]
        assert [e["detail"]["after"] for e in entries] == [
            {"app-x": {"reviewer": BEN}}, {"app-y": {"reviewer": CAT}}]

    def test_while_a_live_deal_holds_the_market_it_is_left_to_that_deal(
            self, stranded, monkeypatch):
        _lease(stranded, seconds=30)
        pauses = []
        monkeypatch.setattr(ReviewTeam.time, "sleep", pauses.append)

        assert _next(BEN) is None

        # Answered at once, never waiting on the market as a change of reviewers does.
        assert pauses == []
        assert _waiting(stranded) == ["app-x", "app-y"]
        assert _reviewer(stranded, "x") is None
        assert stranded.markets.doc["reviewTeam"]["dealing"]["by"] == DEAD_DEAL
        assert _dealt_entries(stranded) == []

    def test_with_nothing_waiting_it_writes_nothing(self, world):
        assert _choose([ANA, BEN, CAT]).status_code == 200
        writes, entries = world.markets.writes, len(world.history.documents)

        assert _next(ANA) == "v1"

        assert world.markets.writes == writes
        assert len(world.history.documents) == entries


class Spy:
    """A collection that records every call made on it."""

    def __init__(self, inner):
        self.inner = inner
        self.calls = []

    def __getattr__(self, name):
        attr = getattr(self.inner, name)
        if not callable(attr):
            return attr

        def call(*args, **kwargs):
            self.calls.append(name)
            return attr(*args, **kwargs)
        return call


@pytest.fixture
def spied(monkeypatch, stranded):
    markets, applications = Spy(stranded.markets), Spy(stranded.applications)
    monkeypatch.setattr(ReviewTeam, "markets_collection", markets)
    monkeypatch.setattr(ApplicationsApi, "applications_collection", applications)
    return markets, applications


class TestDealWaiting:
    def test_with_no_reviewers_chosen_reads_and_writes_nothing(self, stranded, spied):
        stranded.markets.doc["reviewTeam"]["reviewers"] = []

        dealt = ReviewTeam.deal_waiting(
            MarketsApi.market_from_document(stranded.markets.doc), None)

        assert dealt == 0
        assert [spy.calls for spy in spied] == [[], []]

    def test_on_an_archived_market_reads_and_writes_nothing(self, stranded, spied):
        stranded.markets.doc["phase"] = MarketPhase.ARCHIVED.value

        dealt = ReviewTeam.deal_waiting(
            MarketsApi.market_from_document(stranded.markets.doc), None)

        assert dealt == 0
        assert [spy.calls for spy in spied] == [[], []]
        assert _waiting(stranded) == ["app-x", "app-y"]

    def test_deals_what_waits_and_answers_how_many(self, stranded):
        dealt = ReviewTeam.deal_waiting(
            MarketsApi.market_from_document(stranded.markets.doc), None)

        assert dealt == 2
        assert (_reviewer(stranded, "x"), _reviewer(stranded, "y")) == (BEN, CAT)


class TestTheApplicationsList:
    def test_a_read_leaves_stranded_arrivals_waiting(self, stranded):
        writes = stranded.markets.writes

        response = _client(VIEWER).get(f"/markets/{MARKET}/applications")

        assert response.status_code == 200, response.get_json()
        assert _waiting(stranded) == ["app-x", "app-y"]
        assert (_reviewer(stranded, "x"), _reviewer(stranded, "y")) == (None, None)
        assert stranded.markets.writes == writes
        assert _dealt_entries(stranded) == []
