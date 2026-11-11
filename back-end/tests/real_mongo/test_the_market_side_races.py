"""The market side's concurrency guarantees, each run on a real server with real threads.

Each guarantee here is one write conditional on what its request read: the phase move holds the
phase, Back to review and Publish results hold each other's fact, an assignment write holds its
revision, and a deal holds the market by a lease. The hermetic suite proves each one's logic through
fakes; these run the losing branch, the one each guarantee exists for, where it lives: every
racing thread stands on the same read, so their writes meet on the server.
"""
import threading
from datetime import datetime, timedelta, timezone

import pytest

from datatypes import MarketPhase, VendorAssignmentResult
from market_documents import MARKETS_COLLECTION, market_from_document
from market_write import MarketChanged

import api.applicants as ApplicantsApi
import api.markets as MarketsApi
import api.placements as PlacementsApi
import review_team as ReviewTeam
from real_mongo import harness

OWNER = "race-owner@example.com"
ENTERED = "2026-11-01T09:00:00+00:00"
#: Publish results' judgment, as the module holds it before any test wraps it.
JUDGE_PUBLISH = ApplicantsApi.publish_results_refusal
#: How long a racing thread waits for the other at a meeting point, so a bug fails, not hangs.
MEETING_TIMEOUT_SECONDS = 20


def _history(*phases):
    return [{"phase": phase.value, "enteredAt": ENTERED, "by": OWNER} for phase in phases]


def _stored(real_db, market_id):
    return real_db[MARKETS_COLLECTION].find_one({"id": market_id})


def _row(email, table_code):
    return VendorAssignmentResult(
        email=email, date="2026-12-05", table_code=table_code, table_choice="Full Table",
        section="Main Hall", tier="Gold", location="Hall")


def _outcomes(answered, refusal):
    """Which threads landed (answered None) and which were refused by ``refusal``; any other
    answer fails the test with it."""
    unexpected = [a for a in answered if a is not None and not isinstance(a, refusal)]
    assert unexpected == []
    return ([i for i, a in enumerate(answered) if a is None],
            [i for i, a in enumerate(answered) if isinstance(a, refusal)])


class TestTwoPhaseMovesFromOnePhaseLandOne:
    @pytest.mark.parametrize("from_phase, history, targets", [
        (MarketPhase.DRAFT, (MarketPhase.DRAFT,),
         (MarketPhase.APPLICATIONS, MarketPhase.APPLICATIONS)),
        (MarketPhase.APPLICATIONS, (MarketPhase.DRAFT, MarketPhase.APPLICATIONS),
         (MarketPhase.ASSIGNMENT, MarketPhase.DRAFT)),
    ], ids=["the same move twice", "two moves out of one phase"])
    def test_one_lands_the_other_is_told_the_phase_moved_and_the_history_holds_one_entry(
            self, real_db, signed_in, market_in, race, from_phase, history, targets):
        signed_in(OWNER)
        market = market_in(from_phase, intakeMode="form", phaseHistory=_history(*history))
        as_read = _stored(real_db, market["id"])
        harness.warm(real_db[MARKETS_COLLECTION], 2)

        answered = race(2, lambda i: MarketsApi.apply_phase_transition(
            as_read, targets[i].value, by=f"mover-{i}@example.com"))

        landed, refused = _outcomes(answered, MarketsApi.PhaseChangedUnderRequest)
        assert len(landed) == 1 and len(refused) == 1, answered
        winner, loser = targets[landed[0]], answered[refused[0]]
        assert (loser.actual_phase, loser.from_phase) == (winner.value, from_phase.value)
        stored = _stored(real_db, market["id"])
        assert stored["phase"] == winner.value
        assert stored["isDraft"] is (winner is MarketPhase.DRAFT)
        assert [(e["phase"], e["by"]) for e in stored["phaseHistory"][len(history):]] == [
            (winner.value, f"mover-{landed[0]}@example.com")]


class TestBackToReviewAgainstPublishResults:
    """Back to review is refused once results are published, and Publish results only in
    Assignment, so each write holds what the other changes: one of two in flight together is
    refused, and the market never stands in the review with its results published (T207)."""

    @pytest.fixture
    def publishable(self, real_db, signed_in, market_in):
        """A market in Assignment whose allocation Publish results takes, and its document as
        both requests read it."""
        signed_in(OWNER)

        def make():
            market = market_in(
                MarketPhase.ASSIGNMENT, intakeMode="form",
                phaseHistory=_history(MarketPhase.DRAFT, MarketPhase.APPLICATIONS,
                                      MarketPhase.ASSIGNMENT),
                assignmentObject={"vendorAssignments": [
                    {"email": "vendor-1@example.com", "date": "2026-12-05", "tableCode": "A1",
                     "tableChoice": "Full Table", "section": "Main Hall", "tier": "Gold",
                     "location": "Hall", "handPlaced": False}],
                    "assignmentStatistics": None, "revision": 1})
            return market["id"], _stored(real_db, market["id"])
        return make

    def _race(self, monkeypatch, race, market_id, as_read, first=None):
        """Back to review (thread 0) and Publish results (thread 1), each writing only once both
        have read; with ``first`` named, the other writes only once that one's write returned."""
        both_read = threading.Barrier(2, timeout=MEETING_TIMEOUT_SECONDS)
        written = {"back": threading.Event(), "publish": threading.Event()}
        other = {"back": "publish", "publish": "back"}

        def meet(name):
            both_read.wait()
            if first is not None and first != name:
                assert written[other[name]].wait(MEETING_TIMEOUT_SECONDS)

        judged = []

        def publish_refusal_then_meet(market):
            refusal = JUDGE_PUBLISH(market)
            # Publish's own judgment only: a refused move asks it again, after its write, and by
            # then Publish has judged.
            if not judged:
                judged.append(True)
                meet("publish")
            return refusal

        monkeypatch.setattr(ApplicantsApi, "publish_results_refusal", publish_refusal_then_meet)

        def back():
            meet("back")
            try:
                return MarketsApi.apply_phase_transition(
                    as_read, MarketPhase.APPLICATIONS.value, by=OWNER)
            finally:
                written["back"].set()

        def publish():
            try:
                return ApplicantsApi.publish_results(market_id, OWNER)
            finally:
                written["publish"].set()

        return race(2, lambda i: (back, publish)[i]())

    @pytest.mark.parametrize("first", [None, "publish", "back"],
                             ids=["at once", "Publish results writes first",
                                  "Back to review writes first"])
    def test_one_is_refused_and_the_review_never_stands_with_results_published(
            self, real_db, monkeypatch, race, publishable, first):
        rounds = 10 if first is None else 1
        harness.warm(real_db[MARKETS_COLLECTION], 2)
        for _round in range(rounds):
            market_id, as_read = publishable()

            moved, published = self._race(monkeypatch, race, market_id, as_read, first)

            stored = _stored(real_db, market_id)
            assert not (stored["phase"] == MarketPhase.APPLICATIONS.value
                        and stored.get("resultsPublished")), stored
            if moved is None:
                assert isinstance(published, MarketChanged), published
                assert stored["phase"] == MarketPhase.APPLICATIONS.value
                assert stored.get("resultsPublished") is not True
                assert first in (None, "back")
            else:
                assert isinstance(moved, MarketsApi.MoveBlockedUnderRequest), moved
                assert [b.id for b in moved.blockers] == ["results_not_published"]
                assert published == ({"results_published": True}, 200)
                assert stored["phase"] == MarketPhase.ASSIGNMENT.value
                assert stored["resultsPublished"] is True
                assert first in (None, "publish")


class TestTwoAssignmentWritesFromOneRevisionLandOne:
    @pytest.mark.parametrize("stored_revision, read_revision, after", [
        ({"revision": 3}, 3, 4),
        ({"revision": 0}, 0, 1),
        ({}, 0, 1),
    ], ids=["a counted revision", "revision 0", "no revision yet"])
    def test_one_lands_counted_once_the_other_is_refused_and_the_rows_are_the_winners(
            self, real_db, signed_in, market_in, race, stored_revision, read_revision, after):
        signed_in(OWNER)
        market = market_in(MarketPhase.ASSIGNMENT, assignmentObject={
            "vendorAssignments": [], "assignmentStatistics": None, **stored_revision})
        rows = [[_row(f"vendor-{i}@example.com", f"A{i + 1}")] for i in range(2)]
        harness.warm(real_db[MARKETS_COLLECTION], 2)

        as_read = market_from_document(_stored(real_db, market["id"]))
        assert (as_read.assignment_object.revision or 0) == read_revision

        answered = race(2, lambda i: PlacementsApi._store_vendor_assignments(
            as_read, rows[i], f"2026-11-0{i + 1}T09:00:00Z"))

        landed, refused = _outcomes(answered, MarketChanged)
        assert len(landed) == 1 and len(refused) == 1, answered
        winner = landed[0]
        stored = _stored(real_db, market["id"])["assignmentObject"]
        assert stored["revision"] == after
        assert stored["assignmentDate"] == f"2026-11-0{winner + 1}T09:00:00Z"
        assert [row["email"] for row in stored["vendorAssignments"]] == [
            f"vendor-{winner}@example.com"]


class _Clock:
    """``review_team``'s clock, set by the test, so a lease's expiry is reached without a wait."""

    def __init__(self, monkeypatch):
        self.now = datetime(2026, 11, 10, 9, 0, tzinfo=timezone.utc)
        clock = self

        class Frozen(datetime):
            @classmethod
            def now(cls, tz=None):
                return clock.now.astimezone(tz) if tz else clock.now.replace(tzinfo=None)

        monkeypatch.setattr(ReviewTeam, "datetime", Frozen)


class TestTheDealingLease:
    N = 10

    @pytest.fixture
    def clock(self, monkeypatch):
        return _Clock(monkeypatch)

    @pytest.fixture
    def market(self, real_db, signed_in, market_in):
        signed_in(OWNER)
        return lambda **overrides: market_in(MarketPhase.APPLICATIONS, **overrides)["id"]

    def _take(self, race, prefix):
        """``N`` deals trying to hold the market at once; answers which of them hold it."""
        return [i for i, held in enumerate(race(self.N, lambda i: ReviewTeam._hold(
            self.market_id, f"{prefix}-{i}"))) if held is True]

    @pytest.mark.parametrize("team", [{"reviewTeam": {"reviewers": [], "turn": 4}}, {}],
                             ids=["a market with a team", "a market that never had one"])
    def test_n_deals_at_once_one_holds_it(self, real_db, race, clock, market, team):
        self.market_id = market(**team)
        harness.warm(real_db[MARKETS_COLLECTION], self.N)

        holding = self._take(race, "deal")

        assert len(holding) == 1, holding
        stored = _stored(real_db, self.market_id)["reviewTeam"]
        assert stored["dealing"] == {
            "by": f"deal-{holding[0]}",
            "until": (clock.now + ReviewTeam.DEALING_LEASE).isoformat()}
        assert stored["turn"] == team.get("reviewTeam", {}).get("turn", 0)

    def test_a_held_lease_refuses_every_deal_until_it_lapses_then_one_takes_it(
            self, real_db, race, clock, market):
        self.market_id = market()
        harness.warm(real_db[MARKETS_COLLECTION], self.N)
        assert ReviewTeam._hold(self.market_id, "first")

        clock.now += ReviewTeam.DEALING_LEASE - timedelta(seconds=1)
        assert self._take(race, "early") == []
        assert _stored(real_db, self.market_id)["reviewTeam"]["dealing"]["by"] == "first"

        clock.now += timedelta(seconds=2)
        holding = self._take(race, "late")

        assert len(holding) == 1, holding
        assert _stored(real_db, self.market_id)["reviewTeam"]["dealing"]["by"] == (
            f"late-{holding[0]}")

    def test_a_deal_whose_lease_lapsed_lets_go_of_nothing_another_took(
            self, real_db, clock, market):
        self.market_id = market()
        assert ReviewTeam._hold(self.market_id, "lapsed")
        clock.now += ReviewTeam.DEALING_LEASE + timedelta(seconds=1)
        assert ReviewTeam._hold(self.market_id, "next")
        before = _stored(real_db, self.market_id)

        ReviewTeam._let_go(self.market_id, "lapsed")

        assert _stored(real_db, self.market_id) == before
        assert before["reviewTeam"]["dealing"]["by"] == "next"

    @pytest.mark.parametrize("team", [{"reviewTeam": {"reviewers": [], "turn": 2}}, {}],
                             ids=["a team with no lease", "no team at all"])
    def test_letting_go_of_a_market_nobody_holds_changes_nothing(self, real_db, market, team):
        self.market_id = market(**team)
        before = _stored(real_db, self.market_id)

        ReviewTeam._let_go(self.market_id, "any-deal")

        assert _stored(real_db, self.market_id) == before
