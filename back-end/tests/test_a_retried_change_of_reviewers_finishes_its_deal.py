"""Choosing the same reviewers again finishes a change that stopped, and a deal checks its hold
(T270, ADR 0020).

A change of reviewers writes the team first and deals the open applications after, so one the host
ended half way, or whose deal failed, stored the team and dealt part of the pool. Pressing Save
again with the same reviewers answered at once, as for an unchanged set: the rest stayed undealt
and the turn stayed at 0, so the next arrival went to the first reviewer whatever the deal had
reached. The team write now marks the change unfinished, its last write takes the mark away with
the turn, and the same choice on a marked team finishes the deal.

Every write a deal makes to the market under its lease names the lease, and none read whether it
matched: a change that lost its hold before writing the team went on to deal to a team that was
never stored, and one that lost it before the turn dropped it in silence. Now the change is refused
in words, and a deal of arrivals says so in the log.
"""
import logging

from test_choosing_reviewers_deals_the_open_applications import (  # noqa: F401  (the fixture)
    ANA, BEN, CAT, DEE, OPEN, _choose, _entries, _reviewers, world,
)
from test_every_order_of_a_deal import _arrive

import api.applications as ApplicationsApi
import history as History
import review_team as ReviewTeam

ANOTHER_DEAL = {"by": "another-deal", "until": "2999-01-01T00:00:00+00:00"}


class Stopped(Exception):
    """The host ending the request, or a step failing, at the point a test names."""


def stop_at_call(monkeypatch, owner, name, call):
    """``owner.name`` raises on its ``call``-th call, then is itself again."""
    original = getattr(owner, name)
    calls = []

    def counted(*args, **kwargs):
        calls.append(True)
        if len(calls) == call:
            monkeypatch.setattr(owner, name, original)
            raise Stopped()
        return original(*args, **kwargs)

    monkeypatch.setattr(owner, name, counted)


def another_deal_takes_the_market_before(world, monkeypatch, is_the_write):
    """The next write to the market that ``is_the_write`` names first finds another deal holding
    the market, as a deal whose lease lapsed finds one that took it."""
    markets = world.markets
    real = markets.update_one
    taken = []

    def update_one(query, update):
        if not taken and is_the_write(update):
            taken.append(True)
            markets.doc["reviewTeam"]["dealing"] = dict(ANOTHER_DEAL)
        return real(query, update)

    monkeypatch.setattr(markets, "update_one", update_one)
    return taken


def the_team_write(update):
    return "reviewTeam.reviewers" in (update.get("$set") or {})


def the_last_write(update):
    return "reviewTeam.unfinishedChoice" in (update.get("$unset") or {})


def the_turn_write(update):
    return set(update.get("$set") or {}) == {"reviewTeam.turn"}


def _team(world):
    return world.markets.doc["reviewTeam"]


def _unfinished(world):
    return "unfinishedChoice" in _team(world)


class TestTheSameChoiceAgainFinishesAStoppedChange:
    def test_a_change_stopped_at_its_second_deal_is_finished_by_saving_the_same_reviewers(
            self, world, monkeypatch):
        stop_at_call(monkeypatch, ApplicationsApi, "deal", call=2)

        assert _choose([ANA, BEN, CAT]).status_code == 500
        assert [_reviewers(world)[v] for v in OPEN] == [ANA, None, None, None, None, None, None]

        response = _choose([ANA, BEN, CAT])

        assert response.status_code == 200, response.get_json()
        # v1 was dealt to Ana before the stop: the retry moves the six it left.
        assert response.get_json()["dealt"] == 6
        assert [_reviewers(world)[v] for v in OPEN] == [ANA, BEN, CAT, ANA, BEN, CAT, ANA]
        assert _team(world)["turn"] == 7
        assert not _unfinished(world)

    def test_the_next_arrival_after_the_finish_goes_where_the_turn_says(self, world, monkeypatch):
        stop_at_call(monkeypatch, ApplicationsApi, "deal", call=2)
        _choose([ANA, BEN, CAT])
        _choose([ANA, BEN, CAT])

        _arrive(world, "next", 21)

        # Seven dealt Ana, Ben, Cat, Ana, Ben, Cat, Ana: the eighth is Ben's.
        assert _reviewers(world)["next"] == BEN
        assert _team(world)["turn"] == 8

    def test_the_history_records_the_change_once_and_the_deal_the_finish_made(
            self, world, monkeypatch):
        stop_at_call(monkeypatch, ApplicationsApi, "deal", call=2)
        _choose([ANA, BEN, CAT])

        _choose([ANA, BEN, CAT])

        [chosen] = _entries(world, History.REVIEWERS)
        assert chosen["detail"] == {
            "before": {"reviewers": []}, "after": {"reviewers": [ANA, BEN, CAT]}}
        [deal] = _entries(world, History.DEALT)
        assert (deal["actor"], deal["action"], deal["detail"]["cause"]) == (
            "admin@market.test", "choose-reviewers", "reviewers_changed")
        assert deal["subject"] == {"application_ids": [f"app-{v}" for v in OPEN[1:]]}

    def test_a_follow_up_the_stopped_change_took_from_a_removed_reviewer_is_handed_on(
            self, world, monkeypatch):
        _choose([ANA, BEN])
        follow_up = next(d for d in world.applications.documents if d["id"] == "app-follow-up")
        follow_up["follow_up_owner"] = {"user_id": "user-ben", "email": BEN}
        follow_up["reviewer"] = {"user_id": "user-ben", "email": BEN}
        # The follow-up arrived first, so it is the first the change deals.
        stop_at_call(monkeypatch, ApplicationsApi, "deal_follow_up", call=1)
        assert _choose([ANA]).status_code == 500
        assert follow_up["follow_up_owner"]["email"] == BEN

        assert _choose([ANA]).status_code == 200

        assert (follow_up["status"], follow_up["follow_up_owner"]["email"],
                follow_up["reviewer"]["email"]) == ("needs_follow_up", ANA, ANA)
        assert set(_reviewers(world)[v] for v in OPEN) == {ANA}

    def test_a_different_choice_after_a_stopped_change_hands_on_its_removed_reviewers_follow_up(
            self, world, monkeypatch):
        _choose([ANA, BEN])
        follow_up = next(d for d in world.applications.documents if d["id"] == "app-follow-up")
        follow_up["follow_up_owner"] = {"user_id": "user-ben", "email": BEN}
        stop_at_call(monkeypatch, ApplicationsApi, "deal_follow_up", call=1)
        _choose([ANA])

        assert _choose([ANA, CAT]).status_code == 200

        assert follow_up["follow_up_owner"]["email"] in (ANA, CAT)
        assert not _unfinished(world)

    def test_a_finished_change_saved_again_writes_and_records_nothing(self, world, monkeypatch):
        stop_at_call(monkeypatch, ApplicationsApi, "deal", call=2)
        _choose([ANA, BEN, CAT])
        _choose([ANA, BEN, CAT])
        writes, entries = world.markets.writes, len(world.history.documents)

        response = _choose([ANA, BEN, CAT])

        assert response.get_json()["dealt"] == 0
        assert (world.markets.writes, len(world.history.documents)) == (writes, entries)


class TestTheMarkIsTakenAwayInEveryWayAChangeEnds:
    def test_it_stands_while_the_change_is_unfinished(self, world, monkeypatch):
        stop_at_call(monkeypatch, ApplicationsApi, "deal", call=2)

        _choose([ANA, BEN, CAT])

        assert _unfinished(world)

    def test_a_pool_dealt_takes_it_away_with_the_turn(self, world):
        _choose([ANA, BEN, CAT])

        assert _team(world)["turn"] == 7
        assert not _unfinished(world)

    def test_an_empty_pool_takes_it_away_with_the_turn_at_0(self, world):
        world.applications.documents = []

        _choose([ANA])

        assert _team(world)["turn"] == 0
        assert not _unfinished(world)

    def test_nobody_able_takes_it_away_with_the_turn_at_0(self, world):
        _choose([ANA, BEN])
        for user_id in ("user-ana", "user-ben"):
            world.markets.doc["roles"].pop(user_id)

        assert _choose([ANA]).get_json()["dealt"] == 0

        assert _team(world)["turn"] == 0
        assert not _unfinished(world)

    def test_none_chosen_takes_it_away_with_the_turn_at_0(self, world):
        _choose([ANA, BEN])

        _choose([])

        assert _team(world) == {"reviewers": [], "turn": 0}


class TestADealChecksItsHold:
    def test_a_change_that_lost_the_market_before_its_team_write_is_refused_and_deals_nothing(
            self, world, monkeypatch):
        _choose([ANA, BEN, CAT])
        world.history.documents.clear()
        before = [_reviewers(world)[v] for v in OPEN]
        taken = another_deal_takes_the_market_before(world, monkeypatch, the_team_write)

        response = _choose([BEN, CAT, DEE])

        assert taken == [True]
        assert response.status_code == 409
        assert response.get_json()["error"] == ReviewTeam.DEALING_BUSY
        assert [_reviewers(world)[v] for v in OPEN] == before
        assert [r["email"] for r in _team(world)["reviewers"]] == [ANA, BEN, CAT]
        assert not _unfinished(world)
        assert world.history.documents == []

    def test_a_change_that_lost_the_market_before_its_last_write_is_refused_and_stays_unfinished(
            self, world, monkeypatch):
        taken = another_deal_takes_the_market_before(world, monkeypatch, the_last_write)

        response = _choose([ANA, BEN, CAT])

        assert taken == [True]
        assert response.status_code == 409
        assert response.get_json()["error"] == ReviewTeam.DEALING_BUSY
        assert _unfinished(world)
        assert _team(world)["turn"] == 0
        # The deal it made is recorded before the last write.
        [deal] = _entries(world, History.DEALT)
        assert len(deal["subject"]["application_ids"]) == 7

    def test_the_same_choice_once_the_other_deal_let_go_finishes_it(self, world, monkeypatch):
        another_deal_takes_the_market_before(world, monkeypatch, the_last_write)
        _choose([ANA, BEN, CAT])
        del _team(world)["dealing"]

        response = _choose([ANA, BEN, CAT])

        assert response.status_code == 200
        # The stopped change wrote every share before it lost the market: nothing moves now.
        assert response.get_json()["dealt"] == 0
        assert [_reviewers(world)[v] for v in OPEN] == [ANA, BEN, CAT, ANA, BEN, CAT, ANA]
        assert _team(world)["turn"] == 7
        assert not _unfinished(world)
        assert [e["kind"] for e in world.history.documents] == [History.REVIEWERS, History.DEALT]

    def test_a_deal_of_arrivals_that_lost_the_market_before_its_turn_write_says_so(
            self, world, monkeypatch, caplog):
        _choose([ANA, BEN, CAT])
        another_deal_takes_the_market_before(world, monkeypatch, the_turn_write)

        with caplog.at_level(logging.WARNING, logger=ReviewTeam.logger.name):
            _arrive(world, "x", 21)

        assert _reviewers(world)["x"] == BEN
        assert _team(world)["turn"] == 7
        [warning] = [r for r in caplog.records if r.name == ReviewTeam.logger.name]
        assert warning.levelno == logging.WARNING
        assert "market-1" in warning.getMessage()
        assert "1 application" in warning.getMessage()

