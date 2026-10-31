"""Removing a reviewer deals their share and their follow-ups again; one who can no longer review is
skipped and marked (E38/F07/S02, ADR 0020).

Someone falls ill and an Admin unticks them. Their open applications are dealt again among the
rest, as any change deals every open application, and the follow-ups they own go back into the pool
and are handed to whoever they are dealt to, so someone still reaches out and the history says who
held it before. Follow-ups owned by anyone still a reviewer, or by someone who never was one, stay.
A chosen reviewer who no longer holds a role on the market is skipped by every deal and served as
not able, until an Admin removes them.
"""
import pytest

from test_choosing_reviewers_deals_the_open_applications import (  # noqa: F401  (the fixture)
    ADMIN, ANA, BEN, CAT, DEE, EDITOR, MARKET, OPEN, _application, _choose, _entries, _read,
    _reviewers, world,
)

import api.organizations as OrgsApi
import history as History

ORG_ID = "org-1"


def _follow_up(name, day, owner, reviewer=None):
    person = {"user_id": f"user-{owner.split('@')[0].split('.')[0]}", "email": owner}
    return _application(
        name, day, status="needs_follow_up", verdict_at="2026-10-09T00:00:00+00:00",
        verdict_by={"kind": "person", **person}, follow_up_owner=person,
        **({"reviewer": {"user_id": f"user-{reviewer.split('@')[0]}", "email": reviewer}}
           if reviewer else {}))


def _doc(world, name):
    return next(d for d in world.applications.documents if d["id"] == f"app-{name}")


def _owner(world, name):
    return (_doc(world, name).get("follow_up_owner") or {}).get("email")


@pytest.fixture
def follow_ups(world):
    """Ana and Ben each own a follow-up, after the seven open applications arrived."""
    world.applications.documents += [
        _follow_up("fa", 8, ANA, reviewer=ANA), _follow_up("fb", 9, BEN, reviewer=BEN)]
    _choose([ANA, BEN, CAT])
    world.history.documents.clear()
    return world


class TestRemovingOne:
    def test_their_open_applications_are_dealt_among_the_rest(self, follow_ups):
        _choose([BEN, CAT])

        dealt = _reviewers(follow_ups)
        assert [dealt[v] for v in OPEN] == [BEN, CAT, BEN, CAT, BEN, CAT, BEN]

    def test_their_follow_up_is_handed_to_whoever_it_is_dealt_to(self, follow_ups):
        _choose([BEN, CAT])

        fa = _doc(follow_ups, "fa")
        assert fa["status"] == "needs_follow_up"
        # Eighth in the pool, after the seven open applications: Cat's turn.
        assert (_owner(follow_ups, "fa"), fa["reviewer"]["email"]) == (CAT, CAT)

    def test_the_others_follow_ups_and_every_decided_one_stay_where_they_were(self, follow_ups):
        _choose([BEN, CAT])

        assert _owner(follow_ups, "fb") == BEN
        # Handed to someone who was never a reviewer: theirs to chase still.
        assert _owner(follow_ups, "follow-up") == EDITOR
        assert _doc(follow_ups, "decided")["status"] == "reviewer_approved"
        assert "reviewer" not in _doc(follow_ups, "decided")

    def test_the_deal_records_who_held_the_follow_up_before(self, follow_ups):
        _choose([BEN, CAT])

        [deal] = _entries(follow_ups, History.DEALT)
        assert deal["detail"]["before"]["app-fa"] == {"reviewer": ANA, "follow_up_owner": ANA}
        assert deal["detail"]["after"]["app-fa"] == {"reviewer": CAT, "follow_up_owner": CAT}
        assert deal["detail"]["after"]["app-v1"] == {"reviewer": BEN}

    def test_a_follow_up_taken_on_meanwhile_is_left_to_its_new_owner(self, follow_ups):
        real = follow_ups.applications.update_one
        fa = _doc(follow_ups, "fa")

        def handed_on_first(query, update):
            if query.get("id") == "app-fa":
                fa["follow_up_owner"] = {"user_id": "user-dee", "email": DEE}
            return real(query, update)

        follow_ups.applications.update_one = handed_on_first

        _choose([BEN, CAT])

        assert _owner(follow_ups, "fa") == DEE


class TestRemovingEveryone:
    def test_open_applications_lose_their_reviewer_and_follow_ups_keep_their_owner(
            self, follow_ups):
        _choose([])

        dealt = _reviewers(follow_ups)
        assert [dealt[v] for v in OPEN] == [None] * 7
        assert (_owner(follow_ups, "fa"), _owner(follow_ups, "fb")) == (ANA, BEN)
        assert _doc(follow_ups, "fa")["reviewer"]["email"] == ANA


class TestOneWhoCanNoLongerReview:
    def test_one_whose_market_role_is_taken_is_served_not_able(self, world):
        _choose([ANA, BEN, CAT])
        world.markets.doc["roles"].pop("user-ben")

        assert _read()["reviewTeam"]["reviewers"] == [
            {"email": ANA, "able": True}, {"email": BEN, "able": False},
            {"email": CAT, "able": True},
        ]

    def test_a_change_deals_nothing_to_them(self, world):
        _choose([ANA, BEN, CAT])
        world.markets.doc["roles"].pop("user-ben")

        _choose([ANA, BEN, CAT, DEE])

        dealt = _reviewers(world)
        assert BEN not in dealt.values()
        assert [dealt[v] for v in OPEN] == [ANA, CAT, DEE, ANA, CAT, DEE, ANA]

    def test_removing_them_deals_their_share_again(self, world):
        _choose([ANA, BEN, CAT])
        world.markets.doc["roles"].pop("user-ben")

        response = _choose([ANA, CAT])

        assert response.status_code == 200
        assert BEN not in _reviewers(world).values()

    def test_one_who_leaves_the_organization_is_served_not_able(self, world, monkeypatch):
        organization = {"id": ORG_ID, "name": "Org", "owner": "user-admin", "admins": [],
                        "members": ["user-dee"], "markets": [MARKET]}
        monkeypatch.setattr(OrgsApi, "get_organization",
                            lambda org_id: dict(organization) if org_id == ORG_ID else None)
        world.markets.doc["organizationId"] = ORG_ID
        world.markets.doc["roles"].pop("user-dee")
        _choose([ANA, DEE])
        assert {r["email"]: r["able"] for r in _read()["reviewTeam"]["reviewers"]}[DEE] is True

        organization["members"] = []

        assert {r["email"]: r["able"] for r in _read()["reviewTeam"]["reviewers"]}[DEE] is False
