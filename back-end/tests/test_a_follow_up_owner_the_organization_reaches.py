"""A follow-up can be owned by anyone the market's roles reach (T15).

An organization's admins run its markets, so they review them too; but a follow-up's owner was
checked against the market's own roles alone. An organization admin marking a follow-up was
offered only the people named on the market, silently handed it to its owner, and choosing
themselves answered "A follow-up's owner must have a role on this market." Everyone the role rule
gives any role may own one, members included: they see the market, as an explicit Viewer does.
"""
from types import SimpleNamespace

import pytest

from conftest import FakeMarketsCollection, stored_market
import app as app_module
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.users as UsersApi
from datatypes import MarketPhase, Organization

ORG_ID = "org-1"
PEOPLE = {
    "owner@market.test": "user-1",
    "sam@market.test": "user-sam",
    "org-owner@org.test": "org-owner",
    "org-admin@org.test": "org-admin",
    "org-member@org.test": "org-member",
    "outsider@x.test": "outsider",
}
EMAILS = {uid: email for email, uid in PEOPLE.items()}
ORGANIZATION_PEOPLE = ["org-owner@org.test", "org-admin@org.test", "org-member@org.test"]
ORGANIZATION = Organization(
    id=ORG_ID, name="Test Org", owner="org-owner", admins=["org-admin"], members=["org-member"],
    markets=["market-123"],
)


def _account(email):
    return SimpleNamespace(
        id=PEOPLE[email], email=email, is_active=True, is_authenticated=True,
        is_anonymous=False, get_id=lambda e=email: e,
    )


@pytest.fixture
def market(monkeypatch, applications):
    """A market in review, of the organization, with an application waiting on a verdict."""
    doc = stored_market(
        MarketPhase.REVIEW, _id="mongo-m1", organizationId=ORG_ID,
        roles={"user-1": "owner", "user-sam": "viewer"},
    )
    monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(doc))
    monkeypatch.setattr(
        OrgsApi, "get_organization",
        lambda org_id: ORGANIZATION.model_dump() if org_id == ORG_ID else None,
    )
    monkeypatch.setattr(
        UsersApi, "get_user", lambda email: _account(email) if email in PEOPLE else None)
    monkeypatch.setattr(
        UsersApi, "get_user_by_id",
        lambda uid: _account(EMAILS[uid]) if uid in EMAILS else None)
    applications.documents = [{
        "id": "app-1", "market_id": "market-123", "applicant_email": "vendor@x.test",
        "form_data": {}, "status": "open", "application_type": "main",
        "submitted_at": None, "updated_at": "2026-10-01T00:00:00Z",
    }]
    return applications.documents


def _signed_in(monkeypatch, email):
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = email
        session["_fresh"] = True
    return client


def _mark(client, owner_email):
    return client.put(
        "/markets/market-123/applications/app-1/review",
        json={"status": "needs_follow_up", "ownerEmail": owner_email},
    )


@pytest.mark.parametrize("owner_email", ORGANIZATION_PEOPLE)
def test_a_follow_up_may_be_marked_for_the_organizations_people(monkeypatch, market, owner_email):
    response = _mark(_signed_in(monkeypatch, "owner@market.test"), owner_email)

    assert response.status_code == 200
    assert market[0]["follow_up_owner"]["email"] == owner_email


@pytest.mark.parametrize("owner_email", ORGANIZATION_PEOPLE)
def test_a_follow_up_may_be_handed_to_the_organizations_people(monkeypatch, market, owner_email):
    client = _signed_in(monkeypatch, "owner@market.test")
    _mark(client, None)

    response = client.put(
        "/markets/market-123/applications/app-1/follow-up-owner", json={"ownerEmail": owner_email})

    assert response.status_code == 200
    assert market[0]["follow_up_owner"]["email"] == owner_email


def test_an_organization_admin_marking_one_owns_it(monkeypatch, market):
    response = _mark(_signed_in(monkeypatch, "org-admin@org.test"), "org-admin@org.test")

    assert response.status_code == 200
    assert market[0]["follow_up_owner"] == {"user_id": "org-admin", "email": "org-admin@org.test"}


def test_an_outsider_may_not_own_one(monkeypatch, market):
    client = _signed_in(monkeypatch, "owner@market.test")

    marked = _mark(client, "outsider@x.test")
    _mark(client, None)
    handed = client.put(
        "/markets/market-123/applications/app-1/follow-up-owner",
        json={"ownerEmail": "outsider@x.test"})

    for response in (marked, handed):
        assert response.status_code == 400
        assert response.get_json()["error"] == (
            "A follow-up's owner must have a role on this market.")
    assert market[0]["follow_up_owner"]["email"] == "owner@market.test"


def test_the_market_read_serves_everyone_who_may_own_one(market):
    served = MarketsApi.get_market_for_user("org-admin@org.test", "market-123")

    assert sorted(served["peopleOnMarket"]) == sorted([
        "owner@market.test", "sam@market.test", *ORGANIZATION_PEOPLE])
    # Manage market keeps listing the roles on the market, and only those.
    assert served["role_emails"] == {"user-1": "owner@market.test", "user-sam": "sam@market.test"}


def test_someone_on_the_market_and_in_its_organization_is_served_once(monkeypatch, market):
    org = ORGANIZATION.model_copy(update={"admins": ["org-admin", "user-sam"]})
    monkeypatch.setattr(OrgsApi, "get_organization", lambda _org_id: org.model_dump())

    served = MarketsApi.get_market_for_user("owner@market.test", "market-123")

    assert served["peopleOnMarket"].count("sam@market.test") == 1
