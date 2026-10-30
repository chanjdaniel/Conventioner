"""A change of reviewers and an arrival are dealt right in every order (E38/F07, ADR 0020).

Four rounds of review each found one more order of a change of reviewers against an arrival that
dealt an application twice or skipped a reviewer. Every deal now holds the market while it reads and
writes the turn, so the orders are not picked by hand here: each test lands the other deal before
every step, every read and write of the markets and applications, that the first one takes, and
checks after each that the shares are even, the turn is where the next arrival expects it, and
nothing is left waiting or held.
"""
import threading
from contextlib import contextmanager

from test_choosing_reviewers_deals_the_open_applications import (  # noqa: F401  (the fixture)
    ANA, BEN, CAT, OPEN, _application, _choose, world,
)

import api.applications as ApplicationsApi
import api.markets as MarketsApi
import history as History
import review_team as ReviewTeam


class Clock:
    """Counts the steps a deal takes, every call on a collection, and before the one it was set
    to land at runs the other deal once. The other deal's own steps are not counted."""

    def __init__(self, land_at, then):
        self.steps = 0
        self.land_at = land_at
        self.then = then
        self.landed = False
        self.inside = False

    def tick(self):
        if self.inside or self.landed:
            return
        self.steps += 1
        if self.steps == self.land_at:
            self.landed = True
            self.inside = True
            try:
                self.then()
            finally:
                self.inside = False


class Counted:
    """A collection whose every call is a step on the clock, one call at a time across threads."""

    lock = threading.RLock()

    def __init__(self, inner, clock):
        self.inner = inner
        self.clock = clock

    def __getattr__(self, name):
        attr = getattr(self.inner, name)
        if not callable(attr):
            return attr

        def step(*args, **kwargs):
            self.clock.tick()
            with Counted.lock:
                return attr(*args, **kwargs)
        return step


def _dealt_seven(world):
    """Ana, Ben and Cat chosen over the seven open applications: 3, 2 and 2, the turn at 7."""
    world.market()
    world.applications.documents = [_application(v, int(v[1:])) for v in OPEN]
    world.history.documents.clear()
    assert _choose([ANA, BEN, CAT]).status_code == 200


def _arrive(world, name, day):
    """An application arrives open and is dealt, as an applicant's save deals it."""
    world.applications.documents.append(_application(name, day))
    ReviewTeam.deal_arrivals(
        MarketsApi.market_from_document(world.markets.doc), f"{name}@vendor.test", History.APPLY,
        only=f"app-{name}")


@contextmanager
def _counting(world, clock):
    """Every call on the markets and the applications a step on ``clock``, while it lasts."""
    places = [(ReviewTeam, "markets_collection", world.markets),
              (MarketsApi, "markets_collection", world.markets),
              (ApplicationsApi, "applications_collection", world.applications)]
    was = [getattr(module, name) for module, name, _inner in places]
    for module, name, inner in places:
        setattr(module, name, Counted(inner, clock))
    try:
        yield clock
    finally:
        for (module, name, _inner), before in zip(places, was):
            setattr(module, name, before)


def _steps_of(world, run):
    """How many steps ``run`` takes, counted on a market dealt seven."""
    _dealt_seven(world)
    with _counting(world, Clock(land_at=None, then=None)) as clock:
        run()
    return clock.steps


def _reviewer_of(world):
    return {doc["id"][len("app-"):]: (doc.get("reviewer") or {}).get("email")
            for doc in world.applications.documents}


def _nothing_left_waiting_or_held(world):
    assert not any(doc.get(ApplicationsApi.ARRIVING_FIELD) for doc in world.applications.documents)
    assert "dealing" not in (world.markets.doc.get("reviewTeam") or {})


def _assert_even_and_next(world, names, team, turn):
    """Each of ``names`` dealt to ``team``, as evenly as round robin deals, the turn at ``turn``,
    and the next arrival to the reviewer that turn names: nobody skipped."""
    dealt = _reviewer_of(world)
    counts = {person: [dealt[n] for n in names].count(person) for person in team}
    assert sorted(counts.values(), reverse=True) == [
        len(names) // len(team) + (1 if i < len(names) % len(team) else 0)
        for i in range(len(team))], dealt
    assert world.markets.doc["reviewTeam"]["turn"] == turn
    _arrive(world, "next", 40)
    assert _reviewer_of(world)["next"] == team[turn % len(team)]
    assert world.markets.doc["reviewTeam"]["turn"] == turn + 1


def _last_deal_of(world, name):
    return [e for e in world.history.documents if e["kind"] == History.DEALT
            and f"app-{name}" in e["subject"]["application_ids"]][-1]


class TestAnArrivalAtEveryStepOfAChange:
    def _land_at_each_step(self, world, team, check):
        change = lambda: _choose(team)  # noqa: E731
        steps = _steps_of(world, change)
        assert steps > 5
        for land_at in range(1, steps + 2):
            _dealt_seven(world)
            with _counting(world, Clock(land_at, lambda: _arrive(world, "x", 21))):
                assert change().status_code == 200
            if land_at == steps + 1:
                _arrive(world, "x", 21)
            check(world, land_at)

    def test_a_new_team_deals_it_evenly_and_skips_no_one(self, world):
        def check(world, land_at):
            _nothing_left_waiting_or_held(world)
            assert _reviewer_of(world)["x"] == _last_deal_of(world, "x")["detail"]["after"][
                "app-x"]["reviewer"], land_at
            _assert_even_and_next(world, [*OPEN, "x"], [BEN, CAT], turn=8)

        self._land_at_each_step(world, [BEN, CAT], check)

    def test_no_team_leaves_it_first_come_first_served(self, world):
        def check(world, land_at):
            _nothing_left_waiting_or_held(world)
            assert set(_reviewer_of(world).values()) == {None}, land_at
            assert world.markets.doc["reviewTeam"]["reviewers"] == []

        self._land_at_each_step(world, [], check)


class TestAChangeAtEveryStepOfAnArrival:
    """The orders notes 10, 13 and 14 found: a change landing as an arrival takes its turn, and
    after. The change waits for the arrival to let go of the market, so it runs on a thread of its
    own, as a second request would."""

    def test_the_change_deals_after_the_arrival_and_skips_no_one(self, world, monkeypatch):
        monkeypatch.setattr(ReviewTeam, "HOLD_PAUSE_SECONDS", 0.001)
        arrival = lambda: _arrive(world, "x", 21)  # noqa: E731
        steps = _steps_of(world, arrival)
        assert steps > 3
        for land_at in range(1, steps + 1):
            _dealt_seven(world)
            answers = []
            change = threading.Thread(target=lambda: answers.append(_choose([BEN, CAT])))
            with _counting(world, Clock(land_at, change.start)):
                arrival()
                change.join(timeout=10)
            assert [a.status_code for a in answers] == [200], land_at
            _nothing_left_waiting_or_held(world)
            _assert_even_and_next(world, [*OPEN, "x"], [BEN, CAT], turn=8)


class TestTwoArrivalsAtOnce:
    def test_at_every_step_of_one_the_other_takes_the_next_turn(self, world):
        arrival = lambda: _arrive(world, "x", 21)  # noqa: E731
        steps = _steps_of(world, arrival)
        for land_at in range(1, steps + 1):
            _dealt_seven(world)
            with _counting(world, Clock(land_at, lambda: _arrive(world, "y", 22))):
                arrival()
            _nothing_left_waiting_or_held(world)
            dealt = _reviewer_of(world)
            # Ana, Ben, Cat, Ana, Ben, Cat, Ana: the eighth and ninth are Ben's and Cat's.
            assert sorted([dealt["x"], dealt["y"]]) == [BEN, CAT], land_at
            _assert_even_and_next(world, [*OPEN, "x", "y"], [ANA, BEN, CAT], turn=9)


class TestTheMarketsHold:
    def test_one_left_by_a_deal_that_stopped_lets_the_next_in(self, world):
        _dealt_seven(world)
        world.markets.doc["reviewTeam"]["dealing"] = {
            "by": "a-deal-that-stopped", "until": "2026-01-01T00:00:00+00:00"}

        _arrive(world, "x", 21)

        assert _reviewer_of(world)["x"] == BEN
        _nothing_left_waiting_or_held(world)

    def test_while_another_deal_holds_it_a_change_is_refused_in_words(self, world, monkeypatch):
        _dealt_seven(world)
        monkeypatch.setattr(ReviewTeam, "CHOICE_WAITS", 0)
        world.markets.doc["reviewTeam"]["dealing"] = {
            "by": "another", "until": "2999-01-01T00:00:00+00:00"}

        response = _choose([BEN, CAT])

        assert response.status_code == 409
        assert response.get_json()["error"] == ReviewTeam.DEALING_BUSY

    def test_an_arrival_that_finds_it_held_waits_for_whoever_holds_it_next(self, world):
        _dealt_seven(world)
        world.markets.doc["reviewTeam"]["dealing"] = {
            "by": "another", "until": "2999-01-01T00:00:00+00:00"}
        _arrive(world, "x", 21)
        assert _reviewer_of(world)["x"] is None

        del world.markets.doc["reviewTeam"]["dealing"]
        _arrive(world, "y", 22)

        dealt = _reviewer_of(world)
        assert (dealt["x"], dealt["y"]) == (BEN, CAT)
        _nothing_left_waiting_or_held(world)
