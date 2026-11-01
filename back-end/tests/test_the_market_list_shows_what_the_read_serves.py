"""The Markets list shows a market only when the market's own read serves it (T181).

T161's rereview found a card on the Markets list whose page then answered "not found": the list
took every market of the reader's organizations and roles, while the read asked whether the stored
document parses and whether the reader's role passes the READ row. The list now asks the same
question, so a card always opens.
"""
import logging
from types import SimpleNamespace

import pytest

from conftest import mongo_matches, sessions_load_through_get_user, stored_market
import app as app_module
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.permissions as PermissionsApi
import api.users as UsersApi

ORG_ID = "org-1"
BROKEN_ORG_ID = "org-broken"
OWNER = "owner"
MEMBER = "member"
ORG_ADMIN = "org-admin"
READER_EMAILS = {who: f"{who}@example.com" for who in (OWNER, MEMBER, ORG_ADMIN)}


def organization_document(org_id=ORG_ID, **overrides):
    doc = {
        "_id": f"mongo-{org_id}", "id": org_id, "name": "Test Org", "owner": OWNER,
        "admins": [ORG_ADMIN], "members": [MEMBER], "markets": [],
    }
    doc.update(overrides)
    return doc


# The ways a stored document and the read can part, each as a market the reader is listed for.
READABLE_BY_ORGANIZATION = "readable-by-organization"
READABLE_BY_ROLE = "readable-by-role"
AN_UNKNOWN_ROLE_ON_SOMEONE_ELSE = "an-unknown-role-on-someone-else"
AN_UNKNOWN_ROLE_ON_THE_READER = "an-unknown-role-on-the-reader"
AN_ORGANIZATION_THAT_DOES_NOT_PARSE = "an-organization-that-does-not-parse"


def market_documents():
    def market(market_id, **overrides):
        return {**stored_market(id=market_id, **overrides), "_id": f"mongo-{market_id}"}

    return [
        market(READABLE_BY_ORGANIZATION, organizationId=ORG_ID),
        market(READABLE_BY_ROLE, roles={"someone": "owner", MEMBER: "editor"}),
        # A role this build does not know, held by someone other than the reader: the model
        # refuses the whole roles map, so the read answers the market as absent.
        market(AN_UNKNOWN_ROLE_ON_SOMEONE_ELSE, organizationId=ORG_ID,
               roles={OWNER: "owner", "someone": "superuser"}),
        # The same, held by the reader, on a market of no organization of theirs.
        market(AN_UNKNOWN_ROLE_ON_THE_READER, roles={"someone": "owner", MEMBER: "superuser"}),
        # The organization's document fails its model (its owner is also a member), so the read
        # grants nothing through it and its member reads nothing there.
        market(AN_ORGANIZATION_THAT_DOES_NOT_PARSE, organizationId=BROKEN_ORG_ID,
               roles={"someone": "owner"}),
    ]


class FakeMarkets:
    """The markets collection: ``find_one`` and ``find`` filter as Mongo does, a role key too."""

    def __init__(self, docs):
        self.docs = docs
        self.finds = 0

    def _matches(self, doc, query):
        (key, condition), = query.items()
        if key.startswith("roles."):
            return (key.split(".", 1)[1] in doc.get("roles", {})) == condition["$exists"]
        return mongo_matches(doc, query)

    def find_one(self, query, projection=None):
        return next((dict(doc) for doc in self.docs if mongo_matches(doc, query)), None)

    def find(self, query, projection=None):
        self.finds += 1
        return iter([dict(doc) for doc in self.docs if self._matches(doc, query)])


@pytest.fixture
def world(monkeypatch):
    organizations = {
        ORG_ID: organization_document(),
        BROKEN_ORG_ID: organization_document(BROKEN_ORG_ID, owner=MEMBER, members=[MEMBER]),
    }
    organization_reads = []
    markets = FakeMarkets(market_documents())
    accounts = {
        email: SimpleNamespace(
            id=who, email=email, is_active=True, is_authenticated=True, is_anonymous=False,
            get_id=lambda e=email: e,
        )
        for who, email in READER_EMAILS.items()
    }

    def organizations_of(email):
        user = accounts.get(email)
        return [
            dict(org) for org in organizations.values()
            if user and user.id in (org["owner"], *org["admins"], *org["members"])
        ]

    def organization(org_id):
        organization_reads.append(org_id)
        return dict(organizations[org_id]) if org_id in organizations else None

    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(OrgsApi, "get_organizations_for_user", organizations_of)
    monkeypatch.setattr(OrgsApi, "get_organization", organization)
    monkeypatch.setattr(PermissionsApi, "organizations_collection", SimpleNamespace(
        find_one=lambda query: organization(query["id"]),
    ))
    monkeypatch.setattr(UsersApi, "get_user", accounts.get)
    monkeypatch.setattr(
        UsersApi, "get_user_by_id",
        lambda uid: next((a for a in accounts.values() if a.id == uid), None),
    )
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    return SimpleNamespace(markets=markets, organization_reads=organization_reads)


def signed_in(who):
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = READER_EMAILS[who]
        session["_fresh"] = True
    return client


def listed(client):
    response = client.get("/markets")
    assert response.status_code == 200
    return {entry["id"]: entry for entry in response.get_json()["markets"]}


def read_status(client, market_id):
    return client.get(f"/markets/{market_id}").status_code


@pytest.mark.parametrize("who", [MEMBER, ORG_ADMIN, OWNER])
def test_every_market_the_list_shows_opens_for_the_same_reader(world, who):
    client = signed_in(who)

    statuses = {market_id: read_status(client, market_id) for market_id in listed(client)}

    assert statuses and set(statuses.values()) == {200}, statuses


@pytest.mark.parametrize("market_id", [
    AN_UNKNOWN_ROLE_ON_SOMEONE_ELSE,
    AN_UNKNOWN_ROLE_ON_THE_READER,
    AN_ORGANIZATION_THAT_DOES_NOT_PARSE,
])
def test_a_market_the_read_refuses_is_not_listed(world, market_id):
    client = signed_in(MEMBER)

    assert read_status(client, market_id) == 404
    assert market_id not in listed(client)


@pytest.mark.parametrize("market_id,role", [
    (READABLE_BY_ORGANIZATION, "viewer"),
    (READABLE_BY_ROLE, "editor"),
])
def test_a_readable_market_is_listed_with_the_role_the_read_serves(world, market_id, role):
    client = signed_in(MEMBER)

    entry = listed(client)[market_id]
    served = client.get(f"/markets/{market_id}").get_json()["market"]

    assert entry["user_role"] == served["user_role"] == role
    assert entry["actionRefusals"] == served["actionRefusals"]


def test_an_unreadable_document_is_logged_once_and_the_others_still_listed(world, caplog):
    client = signed_in(MEMBER)

    with caplog.at_level(logging.WARNING, logger=MarketsApi.logger.name):
        entries = listed(client)

    stored = [r.getMessage() for r in caplog.records if r.getMessage().startswith("Stored market ")]
    unreadable = [AN_UNKNOWN_ROLE_ON_SOMEONE_ELSE, AN_UNKNOWN_ROLE_ON_THE_READER]
    assert len(stored) == len(unreadable), stored
    for market_id in unreadable:
        assert [m for m in stored if m.startswith(f"Stored market {market_id} failed validation")]
    assert set(entries) == {READABLE_BY_ORGANIZATION, READABLE_BY_ROLE}


def test_the_list_reads_no_organization_its_reader_is_already_in(world):
    """``_SummaryLookups`` serves the reader's own organizations; only another one costs a read."""
    listed(signed_in(MEMBER))

    assert world.markets.finds == 2
    assert world.organization_reads == []
