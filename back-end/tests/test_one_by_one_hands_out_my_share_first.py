"""One by one hands a chosen reviewer their own share first (E38/F07/S04, ADR 0020).

With the review dealt among chosen reviewers, a reviewer walking One by one was still handed the
whole queue in arrival order, everyone's share mixed. ``review/next`` now hands a chosen reviewer
the open applications dealt to them first, in arrival order after the one they move on from, and
with ``mineOnly`` nothing else, so the screen can say their share is done and offer the rest. For
anyone who is not chosen, or with nobody chosen, ``mineOnly`` is ignored and the queue is as it
was. The claim is the same conditioned write (ADR 0014): two reviewers asking at once are handed
different cards.
"""
import pytest

from test_choosing_reviewers_deals_the_open_applications import (  # noqa: F401  (the fixture)
    ANA, BEN, CAT, MARKET, OWNER, _choose, _client, world,
)

import api.applications as ApplicationsApi


@pytest.fixture
def dealt(world):
    """Ana, Ben and Cat are chosen: Ana is dealt v1, v4 and v7, Ben v2 and v5, Cat v3 and v6."""
    response = _choose([ANA, BEN, CAT])
    assert response.status_code == 200, response.get_json()
    return world


def _next(who, after=None, mine_only=None, follow_ups=False, want=None):
    body = {"after": after and f"app-{after}", "includeFollowUps": follow_ups}
    if mine_only is not None:
        body["mineOnly"] = mine_only
    if want:
        body["want"] = f"app-{want}"
    response = _client(who).post(f"/markets/{MARKET}/review/next", json=body)
    assert response.status_code == 200, response.get_json()
    application = response.get_json()["application"]
    return application["id"].removeprefix("app-") if application else None


def _doc(world, name):
    return next(d for d in world.applications.documents if d["id"] == f"app-{name}")


def _decide(world, *names):
    for name in names:
        _doc(world, name).update(status="reviewer_approved",
                                 verdict_at="2026-10-21T00:00:00+00:00")


class TestAChosenReviewer:
    def test_is_handed_their_share_first_in_arrival_order(self, dealt):
        assert _next(ANA) == "v1"
        assert _next(ANA, after="v1") == "v4"
        assert _next(ANA, after="v4") == "v7"

    def test_moving_on_from_the_last_of_their_share_comes_round_to_its_first(self, dealt):
        assert _next(ANA, after="v7") == "v1"

    def test_is_handed_the_rest_after_their_share_is_decided(self, dealt):
        _decide(dealt, "v1", "v4", "v7")

        assert _next(ANA) == "v2"
        assert _next(ANA, after="v5", mine_only=False) == "v6"

    def test_with_mine_only_is_handed_nothing_once_their_share_is_decided(self, dealt):
        _decide(dealt, "v1", "v4", "v7")

        assert _next(ANA, mine_only=True) is None

    def test_with_mine_only_is_handed_nothing_while_others_hold_what_is_left(self, dealt):
        _decide(dealt, "v1")
        assert _next(BEN, want="v4") == "v4"
        assert _next(CAT, want="v7") == "v7"

        assert _next(ANA, mine_only=True) is None
        assert _next(ANA, mine_only=False) == "v2"

    def test_with_mine_only_takes_a_follow_up_dealt_to_them_only_when_asked(self, dealt):
        _decide(dealt, "v1", "v4", "v7")
        _doc(dealt, "follow-up")["reviewer"] = {"user_id": "user-ana", "email": ANA}

        assert _next(ANA, mine_only=True) is None
        assert _next(ANA, mine_only=True, follow_ups=True) == "follow-up"

    def test_is_handed_one_asked_for_by_name_first(self, dealt):
        assert _next(ANA, mine_only=True, want="v2") == "v2"

    def test_and_another_asking_at_once_are_handed_different_cards(self, dealt, monkeypatch):
        """The owner, not chosen, asks while Ana's ask is between its read and its write: the
        owner's claim on v1 lands first, so Ana is handed the next of her share."""
        read = ApplicationsApi.list_applications_for_market
        raced = []

        def read_then_race(market_id):
            docs = read(market_id)
            if not raced:
                raced.append(True)
                assert _next(OWNER) == "v1"
            return docs

        monkeypatch.setattr(ApplicationsApi, "list_applications_for_market", read_then_race)

        assert _next(ANA) == "v4"


class TestMineOnlyIsIgnored:
    def test_for_someone_not_chosen(self, dealt):
        assert _next(OWNER, mine_only=True) == "v1"
        assert _next(OWNER, after="v1", mine_only=True) == "v2"

    def test_with_nobody_chosen(self, world):
        assert _next(BEN, mine_only=True) == "v1"
        assert _next(BEN, after="v1", mine_only=True) == "v2"
