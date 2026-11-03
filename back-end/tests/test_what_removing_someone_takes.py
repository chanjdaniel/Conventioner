"""The organization read says what removing someone from it takes (E38/F15/S01).

Manage organization's Remove asks first, naming what the person loses: "They lose access to its
11 markets." An organization's admins and members reach every market it holds through it, so
removing them takes those; but a market role of their own stays, so an admin who created a market,
its Owner, keeps that market. The read serves the count of the organization's markets, counted from
the markets themselves (the organization's ``markets`` list is kept in step at best effort), and,
for each admin and member, how many of them they hold a role on of their own.
"""
import copy
from types import SimpleNamespace

import pytest

from conftest import accounts_by_id, mongo_matches, mongo_project
import api.organizations as OrgsApi
import api.users as UsersApi

ORG_ID = "org-1"
OWNER = "owner@example.com"
ADMIN = "admin@example.com"
MEMBER = "member@example.com"
EDITOR_MEMBER = "editor-member@example.com"


class Organizations:
    """The organizations collection, answering the list's ``$or`` of owner, admins and members."""

    def __init__(self, *docs):
        self.docs = [copy.deepcopy(doc) for doc in docs]

    def find(self, query):
        user_id = query["$or"][0]["owner"]
        return [
            copy.deepcopy(doc) for doc in self.docs
            if user_id in [doc["owner"], *doc["admins"], *doc["members"]]
        ]


class Markets:
    """The markets collection, counting each ``find`` so the read's cost is pinned."""

    def __init__(self, *docs):
        self.docs = [copy.deepcopy(doc) for doc in docs]
        self.queries = []

    def find(self, query, projection=None):
        self.queries.append((query, projection))
        return [
            mongo_project(copy.deepcopy(doc), projection)
            for doc in self.docs if mongo_matches(doc, query)
        ]


def organization(org_id=ORG_ID, **overrides):
    return {
        "_id": f"mongo-{org_id}", "id": org_id, "name": "Seed Test Org", "owner": OWNER,
        "admins": [ADMIN], "members": [MEMBER, EDITOR_MEMBER],
        # Drifted: it names a market that is gone and misses one that is there.
        "markets": ["gone"], "theme": None, **overrides,
    }


def market(market_id, roles, org_id=ORG_ID):
    return {"_id": f"mongo-{market_id}", "id": market_id, "organizationId": org_id, "roles": roles}


@pytest.fixture
def world(monkeypatch):
    def install(organizations, markets):
        monkeypatch.setattr(OrgsApi, "organizations_collection", organizations)
        monkeypatch.setattr(OrgsApi, "markets_collection", markets)
        monkeypatch.setattr(UsersApi, "get_user", lambda email: SimpleNamespace(id=email, email=email))
        accounts_by_id(monkeypatch, lambda uid: SimpleNamespace(id=uid, email=uid))
        return markets

    return install


def test_it_serves_how_many_markets_it_holds_and_who_keeps_some(world):
    markets = world(Organizations(organization()), Markets(
        # The admin created this one, so they are its Owner.
        market("spring", {ADMIN: "owner", EDITOR_MEMBER: "editor"}),
        market("summer", {OWNER: "owner", EDITOR_MEMBER: "viewer"}),
        market("autumn", {OWNER: "owner"}),
        market("elsewhere", {MEMBER: "owner"}, org_id="org-2"),
    ))

    [listed] = OrgsApi.get_organizations_for_user(OWNER)

    assert listed["marketCount"] == 3
    # Only its admins and members, and only those who hold one; never the owner, who cannot be
    # removed, and never anyone outside it.
    assert listed["marketsWithOwnRole"] == {ADMIN: 1, EDITOR_MEMBER: 2}
    # One read of its markets, on the indexed field, fetching only their roles.
    assert markets.queries == [({"organizationId": ORG_ID}, {"roles": 1})]


def test_an_organization_with_no_markets(world):
    world(Organizations(organization()), Markets())

    [listed] = OrgsApi.get_organizations_for_user(MEMBER)

    assert listed["marketCount"] == 0
    assert listed["marketsWithOwnRole"] == {}


def test_a_market_with_no_roles_map_counts_and_keeps_nobody(world):
    world(Organizations(organization()), Markets(
        {"_id": "mongo-bare", "id": "bare", "organizationId": ORG_ID},
    ))

    [listed] = OrgsApi.get_organizations_for_user(ADMIN)

    assert listed["marketCount"] == 1
    assert listed["marketsWithOwnRole"] == {}
