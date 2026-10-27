"""A follow-up can be owned by anyone the market's roles reach, offered by who asks (T15).

An organization's admins run its markets, so they review them too; but a follow-up's owner was
checked against the market's own roles alone. An organization admin marking a follow-up was
offered only the people named on the market, silently handed it to its owner, and choosing
themselves answered "A follow-up's owner must have a role on this market." Everyone the role rule
gives any role may own one, members included: they see the market, as an explicit Viewer does.

Who is offered them depends on who asks (decision/2026-10-22): someone in the organization is
offered its people too, while an Editor from outside it, there by a role on the market alone, is
offered only the people named on the market, and the server takes no one else from them, so the
organization's addresses never reach someone outside it.
"""
from types import SimpleNamespace

import pytest

from conftest import FakeMarketsCollection, sessions_load_through_get_user, stored_market
import app as app_module
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.users as UsersApi
from datatypes import MarketPhase, Organization

ORG_ID = "org-1"
PEOPLE = {
    "owner@market.test": "user-1",
    "sam@market.test": "user-sam",
    "editor@market.test": "user-editor",
    "org-owner@org.test": "org-owner",
    "org-admin@org.test": "org-admin",
    "org-member@org.test": "org-member",
    "outsider@x.test": "outsider",
}
EMAILS = {uid: email for email, uid in PEOPLE.items()}
ORGANIZATION_PEOPLE = ["org-owner@org.test", "org-admin@org.test", "org-member@org.test"]
MARKET_PEOPLE = ["owner@market.test", "sam@market.test", "editor@market.test"]
MARKET_ROLES = {"user-1": "owner", "user-sam": "viewer", "user-editor": "editor"}
# Who asks: the organization's owner and admin, and a member the market names Editor, so that
# they may give verdicts.
IN_THE_ORGANIZATION = ["org-owner@org.test", "org-admin@org.test", "org-member@org.test"]
# The market's Owner and an Editor, neither of them in its organization.
OUTSIDE_THE_ORGANIZATION = ["owner@market.test", "editor@market.test"]
OUTSIDER_REFUSAL = "You can hand a follow-up only to someone named in this market's roles."
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
        roles={**MARKET_ROLES, "org-member": "editor"},
    )
    monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(doc))
    monkeypatch.setattr(
        OrgsApi, "get_organization",
        lambda org_id: ORGANIZATION.model_dump() if org_id == ORG_ID else None,
    )
    sessions_load_through_get_user(monkeypatch)
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


def _hand(client, owner_email):
    return client.put(
        "/markets/market-123/applications/app-1/follow-up-owner", json={"ownerEmail": owner_email})


@pytest.mark.parametrize("requester", IN_THE_ORGANIZATION)
@pytest.mark.parametrize("owner_email", [*MARKET_PEOPLE, *ORGANIZATION_PEOPLE])
def test_someone_in_the_organization_may_mark_one_for_anyone_on_the_market(
        monkeypatch, market, requester, owner_email):
    response = _mark(_signed_in(monkeypatch, requester), owner_email)

    assert response.status_code == 200
    assert market[0]["follow_up_owner"]["email"] == owner_email


@pytest.mark.parametrize("requester", IN_THE_ORGANIZATION)
@pytest.mark.parametrize("owner_email", [*MARKET_PEOPLE, *ORGANIZATION_PEOPLE])
def test_someone_in_the_organization_may_hand_one_to_anyone_on_the_market(
        monkeypatch, market, requester, owner_email):
    client = _signed_in(monkeypatch, requester)
    _mark(client, None)

    response = _hand(client, owner_email)

    assert response.status_code == 200
    assert market[0]["follow_up_owner"]["email"] == owner_email


def test_an_organization_admin_marking_one_owns_it(monkeypatch, market):
    response = _mark(_signed_in(monkeypatch, "org-admin@org.test"), "org-admin@org.test")

    assert response.status_code == 200
    assert market[0]["follow_up_owner"] == {"user_id": "org-admin", "email": "org-admin@org.test"}


@pytest.mark.parametrize("requester", OUTSIDE_THE_ORGANIZATION)
@pytest.mark.parametrize("owner_email", MARKET_PEOPLE)
def test_someone_outside_the_organization_may_hand_one_to_the_people_named_on_the_market(
        monkeypatch, market, requester, owner_email):
    client = _signed_in(monkeypatch, requester)

    marked = _mark(client, owner_email)
    handed = _hand(client, owner_email)

    assert (marked.status_code, handed.status_code) == (200, 200)
    assert market[0]["follow_up_owner"]["email"] == owner_email


@pytest.mark.parametrize("requester", OUTSIDE_THE_ORGANIZATION)
@pytest.mark.parametrize("owner_email", ["org-owner@org.test", "org-admin@org.test"])
def test_someone_outside_the_organization_may_not_hand_one_to_its_people(
        monkeypatch, market, requester, owner_email):
    """Not even by writing the request by hand: the server takes only whom it offered them."""
    client = _signed_in(monkeypatch, requester)

    marked = _mark(client, owner_email)
    _mark(client, None)
    handed = _hand(client, owner_email)

    for response in (marked, handed):
        assert response.status_code == 400
        assert response.get_json()["error"] == OUTSIDER_REFUSAL
    assert market[0]["follow_up_owner"]["email"] == requester


@pytest.mark.parametrize("requester", [*IN_THE_ORGANIZATION, *OUTSIDE_THE_ORGANIZATION])
def test_an_outsider_may_not_own_one(monkeypatch, market, requester):
    client = _signed_in(monkeypatch, requester)

    marked = _mark(client, "outsider@x.test")
    _mark(client, None)
    handed = _hand(client, "outsider@x.test")

    refusal = (OUTSIDER_REFUSAL if requester in OUTSIDE_THE_ORGANIZATION
               else "A follow-up's owner must have a role on this market.")
    for response in (marked, handed):
        assert response.status_code == 400
        assert response.get_json()["error"] == refusal
    assert market[0]["follow_up_owner"]["email"] == requester


@pytest.mark.parametrize("requester", IN_THE_ORGANIZATION)
def test_someone_in_the_organization_reads_everyone_who_may_own_one(market, requester):
    served = MarketsApi.get_market_for_user(requester, "market-123")

    assert sorted(served["peopleOnMarket"]) == sorted([*MARKET_PEOPLE, *ORGANIZATION_PEOPLE])
    # Manage market keeps listing the roles on the market, and only those.
    assert served["role_emails"] == {
        "user-1": "owner@market.test", "user-sam": "sam@market.test",
        "user-editor": "editor@market.test", "org-member": "org-member@org.test",
    }


@pytest.mark.parametrize("requester", OUTSIDE_THE_ORGANIZATION)
def test_someone_outside_the_organization_reads_only_the_people_named_on_the_market(
        market, requester):
    served = MarketsApi.get_market_for_user(requester, "market-123")

    # The member is named on the market, as Editor; the organization's owner and admin are not.
    assert sorted(served["peopleOnMarket"]) == sorted([*MARKET_PEOPLE, "org-member@org.test"])


def test_a_viewer_not_in_the_organization_reads_no_people(market):
    served = MarketsApi.get_market_for_user("sam@market.test", "market-123")

    assert served["peopleOnMarket"] == []
    assert served["role_emails"] == {
        "user-1": "owner@market.test", "user-sam": "sam@market.test",
        "user-editor": "editor@market.test", "org-member": "org-member@org.test",
    }


def test_someone_on_the_market_and_in_its_organization_is_served_once(monkeypatch, market):
    org = ORGANIZATION.model_copy(update={"admins": ["org-admin", "user-sam"]})
    monkeypatch.setattr(OrgsApi, "get_organization", lambda _org_id: org.model_dump())

    served = MarketsApi.get_market_for_user("org-owner@org.test", "market-123")

    assert served["peopleOnMarket"].count("sam@market.test") == 1
