"""A market can never be written into an organization its creation would refuse (E21/F03/S01).

`POST /markets` refuses a missing organization, an unknown one, and one the caller is not a member
of. The market PUT checked none of them: reproduced on a running stack, `organizationId: null` and
`organizationId: "not-a-real-org"` both answered 200 and were stored, the second also added to the
market list of whatever organization carried that id. A market belonging to nothing is a state the
product refuses to produce anywhere else.
"""
from types import SimpleNamespace

import pytest

from conftest import FakeMarketsCollection, client_market, stored_market

import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import api.users as UsersApi


ORGANIZATIONS = {
    "org-home": {"id": "org-home", "owner": "user-1", "admins": [], "members": []},
    "org-joined": {"id": "org-joined", "owner": "someone", "admins": [], "members": ["user-1"]},
    "org-strangers": {"id": "org-strangers", "owner": "someone", "admins": [], "members": []},
}


class FakeOrganizations:
    def __init__(self):
        self.updates = []

    def update_one(self, query, update):
        self.updates.append((query, update))
        return SimpleNamespace(matched_count=1, modified_count=1)


@pytest.fixture
def world(monkeypatch):
    markets = FakeMarketsCollection(stored_market(organizationId="org-home"))
    organizations = FakeOrganizations()
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(MarketsApi, "db", {"organizations": organizations})
    monkeypatch.setattr(PermissionsApi, "user_has_permission", lambda *_a, **_k: True)
    monkeypatch.setattr(OrgsApi, "get_organization", lambda org_id: ORGANIZATIONS.get(org_id))
    monkeypatch.setattr(
        UsersApi,
        "get_user",
        lambda email: SimpleNamespace(id="user-1", email=email) if email == "user-1" else None,
    )
    return SimpleNamespace(markets=markets, organizations=organizations)


@pytest.mark.parametrize(
    "organization_id, reason",
    [
        (None, "required"),
        ("not-a-real-org", "not found"),
        ("org-strangers", "not a member"),
    ],
)
def test_an_organization_creation_would_refuse_is_refused(world, organization_id, reason):
    with pytest.raises(ValueError, match=reason):
        MarketsApi.update_market(
            "market-123", client_market(organization_id=organization_id), "user-1"
        )

    assert world.markets.last_update is None, "the market was written anyway"
    assert world.organizations.updates == [], "an organization's market list was touched"


def test_keeping_the_organization_is_not_a_change(world):
    MarketsApi.update_market("market-123", client_market(organization_id="org-home"), "user-1")

    assert world.markets.last_update["$set"]["organizationId"] == "org-home"
    assert world.organizations.updates == []


def test_creation_and_update_ask_the_same_question():
    """One rule, so the two doors cannot drift apart again."""
    assert MarketsApi.organization_refusal("user-1", None) is not None
