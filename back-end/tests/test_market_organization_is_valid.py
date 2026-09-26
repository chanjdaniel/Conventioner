"""A market's organization is set at creation and never changes (E21/F03/S01, S05, S06).

`POST /markets` refuses a missing organization, an unknown one, and one the caller is not a member
of. The market PUT checked none of them: reproduced on a running stack, `organizationId: null` and
`organizationId: "not-a-real-org"` both answered 200 and were stored. S01 put the same rule on the
PUT, S05 refused every organization change on it, and S06 deleted it - so creation is the only door
a market's organization passes through, and this is its rule.
"""
from types import SimpleNamespace

import pytest

import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.users as UsersApi


ORGANIZATIONS = {
    "org-home": {"id": "org-home", "owner": "user-1", "admins": [], "members": []},
    "org-joined": {"id": "org-joined", "owner": "someone", "admins": [], "members": ["user-1"]},
    "org-strangers": {"id": "org-strangers", "owner": "someone", "admins": [], "members": []},
}


@pytest.fixture(autouse=True)
def world(monkeypatch):
    monkeypatch.setattr(OrgsApi, "get_organization", lambda org_id: ORGANIZATIONS.get(org_id))
    monkeypatch.setattr(
        UsersApi,
        "get_user",
        lambda email: SimpleNamespace(id="user-1", email=email) if email == "user-1" else None,
    )


@pytest.mark.parametrize(
    "organization_id, reason",
    [
        (None, "required"),
        ("", "required"),
        ("not-a-real-org", "not found"),
        ("org-strangers", "not a member"),
    ],
)
def test_a_market_cannot_be_created_into_an_organization_it_cannot_belong_to(
    organization_id, reason
):
    assert reason in MarketsApi.organization_refusal("user-1", organization_id).lower()


@pytest.mark.parametrize("organization_id", ["org-home", "org-joined"])
def test_an_owner_or_member_may_create_a_market_in_it(organization_id):
    assert MarketsApi.organization_refusal("user-1", organization_id) is None
