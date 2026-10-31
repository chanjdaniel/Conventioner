"""Manage market lists everyone with access, at the role that counts and where it comes from
(E38/F12/S01).

The market read served only the market's own roles, so an organization's admins and members, who
act on every market it holds as Admin and Viewer, were missing from "Users with access", and an
organization admin given Editor on the market read as an Editor. The read serves
``peopleWithAccess``: each person with any role, by either route, at the higher of the two, with
the market's own role and their place in the organization beside it.

The organization's rows name its people, so they reach only a reader who belongs to it or may give
and take roles on the market; anyone else reads the market's own roles in the same shape, as
``role_emails`` served them, and no organization person's address.
"""
from collections import Counter
from types import SimpleNamespace

import pytest

from conftest import FakeMarketsCollection, stored_market
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.users as UsersApi
from datatypes import MarketPhase, Organization

ORG_ID = "org-1"
PEOPLE = {
    "owner@market.test": "user-1",
    "market-admin@market.test": "user-admin",
    "editor@market.test": "user-editor",
    "viewer@market.test": "user-viewer",
    "org-owner@org.test": "org-owner",
    "org-admin@org.test": "org-admin",
    "org-member@org.test": "org-member",
}
EMAILS = {uid: email for email, uid in PEOPLE.items()}
# The walk's case: the organization's admin is also given Editor on the market.
MARKET_ROLES = {
    "user-1": "owner", "user-admin": "admin", "user-editor": "editor",
    "user-viewer": "viewer", "org-admin": "editor",
}
ORGANIZATION = Organization(
    id=ORG_ID, name="Test Org", owner="org-owner", admins=["org-admin"], members=["org-member"],
    markets=["market-123"],
)


def _person(user_id, role, market_role, organization_role):
    return {"userId": user_id, "email": EMAILS[user_id], "role": role,
            "marketRole": market_role, "organizationRole": organization_role}


EVERYONE = [
    _person("user-1", "owner", "owner", None),
    _person("user-admin", "admin", "admin", None),
    _person("user-editor", "editor", "editor", None),
    _person("user-viewer", "viewer", "viewer", None),
    _person("org-admin", "admin", "editor", "admin"),
    _person("org-owner", "admin", None, "admin"),
    _person("org-member", "viewer", None, "member"),
]
# The market's own roles, as someone outside the organization who may not give roles reads them.
THE_MARKETS_OWN = [
    _person("user-1", "owner", "owner", None),
    _person("user-admin", "admin", "admin", None),
    _person("user-editor", "editor", "editor", None),
    _person("user-viewer", "viewer", "viewer", None),
    _person("org-admin", "editor", "editor", None),
]


def _account(email):
    return SimpleNamespace(id=PEOPLE[email], email=email)


@pytest.fixture
def lookups(monkeypatch, applications):
    """A market in review, of the organization; answers how often each account was looked up,
    by address or by id alike."""
    counted = Counter()

    def by_email(email):
        counted[email] += 1
        return _account(email) if email in PEOPLE else None

    def by_id(user_id):
        counted[EMAILS.get(user_id, user_id)] += 1
        return _account(EMAILS[user_id]) if user_id in EMAILS else None

    monkeypatch.setattr(UsersApi, "get_user", by_email)
    monkeypatch.setattr(UsersApi, "get_user_by_id", by_id)
    monkeypatch.setattr(
        OrgsApi, "get_organization",
        lambda org_id: ORGANIZATION.model_dump() if org_id == ORG_ID else None)
    _store(monkeypatch)
    return counted


def _store(monkeypatch, **overrides):
    doc = stored_market(
        MarketPhase.APPLICATIONS, _id="mongo-m1", **{
            "organizationId": ORG_ID, "roles": MARKET_ROLES, **overrides})
    monkeypatch.setattr(MarketsApi, "markets_collection", FakeMarketsCollection(doc))


def _served(reader):
    return MarketsApi.get_market_for_user(reader, "market-123")


def _by_id(people):
    return sorted(people, key=lambda person: person["userId"])


@pytest.mark.parametrize("reader", ["org-owner@org.test", "org-admin@org.test", "org-member@org.test"])
def test_someone_in_the_organization_reads_everyone_with_access(lookups, reader):
    served = _served(reader)

    assert _by_id(served["peopleWithAccess"]) == _by_id(EVERYONE)
    assert served["inOrganization"] is True


@pytest.mark.parametrize("reader", ["owner@market.test", "market-admin@market.test"])
def test_someone_who_may_give_roles_reads_everyone_with_access(lookups, reader):
    """Outside the organization, but the table's "Give and take Editor and Viewer roles" row,
    an Admin's by default, lets them in."""
    served = _served(reader)

    assert _by_id(served["peopleWithAccess"]) == _by_id(EVERYONE)
    assert served["inOrganization"] is False


def test_the_row_decides_who_may_give_roles(monkeypatch, lookups):
    """An Editor reads the whole list once the market's table gives Editors the row."""
    _store(monkeypatch, permissions={
        "manage-editors-and-viewers": {"role": "editor", "source": "market"}})

    served = _served("editor@market.test")

    assert _by_id(served["peopleWithAccess"]) == _by_id(EVERYONE)


@pytest.mark.parametrize("reader", ["viewer@market.test", "editor@market.test"])
def test_someone_outside_the_organization_reads_the_markets_own_roles(lookups, reader):
    served = _served(reader)

    assert _by_id(served["peopleWithAccess"]) == _by_id(THE_MARKETS_OWN)
    addresses = {person["email"] for person in served["peopleWithAccess"]}
    assert not addresses & {"org-owner@org.test", "org-member@org.test"}
    assert served["inOrganization"] is False
    # The organization line is every reader's.
    assert served["organization_name"] == "Test Org"


def test_a_market_of_no_organization_serves_its_own_roles(monkeypatch, lookups):
    _store(monkeypatch, organizationId=None)

    served = _served("owner@market.test")

    assert _by_id(served["peopleWithAccess"]) == _by_id(THE_MARKETS_OWN)
    assert served["inOrganization"] is False


def test_someone_in_both_is_listed_once_at_the_higher_role(lookups):
    served = _served("org-owner@org.test")

    rows = [person for person in served["peopleWithAccess"] if person["userId"] == "org-admin"]
    assert rows == [_person("org-admin", "admin", "editor", "admin")]


@pytest.mark.parametrize("reader", [
    "org-owner@org.test", "org-member@org.test", "owner@market.test", "viewer@market.test",
    "editor@market.test",
])
def test_the_read_looks_each_account_up_once(lookups, reader):
    _served(reader)

    assert lookups and max(lookups.values()) == 1, lookups


def test_the_read_looks_each_account_up_once_for_a_chooser_who_gives_no_verdicts(
        monkeypatch, lookups):
    """Someone who may choose the reviewers but not give a verdict is offered candidates from
    the same lookups."""
    _store(monkeypatch, permissions={
        "choose-reviewers": {"role": "viewer", "source": "market"},
        "give-verdicts": {"role": "admin", "source": "market"},
    })

    served = _served("viewer@market.test")

    assert served["reviewerCandidates"]
    assert max(lookups.values()) == 1, lookups
