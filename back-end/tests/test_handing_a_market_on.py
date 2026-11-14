"""A market's Owner transfers its ownership to someone who has access to it (T283).

``POST /markets/<market_id>/hand-on`` with ``{"userId": "<id>"}``: one write makes that person the
Owner and the old Owner an Admin, holding both people's roles as read (``write_market``), and the
market's history records it. Only the Owner may (the fixed row ``hand-on-market``); the new Owner
must be someone the market read finds with access other than the Owner, a market role of their own
or a place in its organization; and it works in every phase, archived included, since an archived
market still needs someone who can delete it.

Pinned through the test client against the real app, over collections that apply the writes as
MongoDB does.
"""
from types import SimpleNamespace

import pytest

from conftest import (
    FakeMarketsCollection,
    FakeOrganizations,
    install_organizations,
    reject_malformed_update,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
    stored_market,
)

skip_without_real_dependencies()

import app as app_module
import api.markets as MarketsApi
import api.users as UsersApi
import history as History
import market_write as MarketWrite
from datatypes import MarketPhase
from market_write import MARKET_CHANGED
from test_reading_the_history import PagedHistory

ORG_ID = "org-1"
MARKET_ID = "market-123"
OWNER = SimpleNamespace(id="user-owner", email="owner@example.com")
ADMIN = SimpleNamespace(id="user-admin", email="admin@example.com")
EDITOR = SimpleNamespace(id="user-editor", email="editor@example.com")
VIEWER = SimpleNamespace(id="user-viewer", email="viewer@example.com")
ORG_OWNER = SimpleNamespace(id="user-org-owner", email="org-owner@example.com")
ORG_MEMBER = SimpleNamespace(id="user-org-member", email="org-member@example.com")
STRANGER = SimpleNamespace(id="user-stranger", email="stranger@example.com")
PEOPLE = (OWNER, ADMIN, EDITOR, VIEWER, ORG_OWNER, ORG_MEMBER, STRANGER)

ROLES = {OWNER.id: "owner", ADMIN.id: "admin", EDITOR.id: "editor", VIEWER.id: "viewer"}
ONLY_TO_SOMEONE_WITH_ACCESS = {
    "error": "You can transfer ownership only to someone who has access to this market."}
CHOOSE_WHO = {"error": "Choose who to transfer ownership to."}
ONLY_THE_OWNER = {"error": "Only the market's owner may transfer this market's ownership to someone else."}


class Markets(FakeMarketsCollection):
    """The ``markets`` collection: one market document, its writes applied as MongoDB applies them
    (``FakeMarketsCollection``), each kept in ``writes``. ``before_write``, when set, runs once
    before the next write is matched, as another request landing between a read and its write."""

    def __init__(self, doc):
        super().__init__(doc)
        self.writes = []
        self.before_write = None

    def find_one_and_update(self, query, update, projection=None, return_document=False):
        reject_malformed_update(update)
        self.writes.append((query, update))
        landing, self.before_write = self.before_write, None
        if landing:
            landing()
        return super().find_one_and_update(query, update, projection, return_document)


@pytest.fixture
def history(monkeypatch):
    fake = PagedHistory()
    monkeypatch.setattr(History, "history_collection", fake)
    return fake


@pytest.fixture
def people(monkeypatch):
    by_email = {person.email: person for person in PEOPLE}
    by_id = {person.id: person for person in PEOPLE}

    def account(email):
        person = by_email.get(email)
        return person and SimpleNamespace(
            id=person.id, email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        )
    monkeypatch.setattr(UsersApi, "get_user", account)
    monkeypatch.setattr(UsersApi, "get_user_by_id", lambda user_id: by_id.get(user_id))
    monkeypatch.setattr(UsersApi, "get_users_by_ids", lambda ids: {
        user_id: by_id[user_id] for user_id in ids if user_id in by_id})
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)


@pytest.fixture
def organization(monkeypatch, people):
    return install_organizations(monkeypatch, FakeOrganizations({
        "_id": "mongo-org-1", "id": ORG_ID, "name": "Ember Markets", "owner": ORG_OWNER.id,
        "admins": [],
        "members": [ORG_MEMBER.id], "markets": [MARKET_ID], "theme": None,
        "people": {ORG_OWNER.id: "owner", ORG_MEMBER.id: "member"},
    }))


def install_market(monkeypatch, phase=MarketPhase.APPLICATIONS):
    markets = Markets(stored_market(
        phase=phase, roles=dict(ROLES), organizationId=ORG_ID, _id="mongo-market-123"))
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(MarketWrite, "markets_collection", markets)
    return markets


@pytest.fixture
def market(monkeypatch, organization, history):
    return install_market(monkeypatch)


def signed_in_as(person):
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = person.email
        session["_fresh"] = True
    return client


def hand_on(by, to, market_id=MARKET_ID):
    return signed_in_as(by).post(f"/markets/{market_id}/hand-on", json={"userId": to.id})


def entries(history):
    return [doc for doc in history.docs if doc.get(History.MARKET_ID_FIELD) == MARKET_ID]


class TestHandingItOn:
    def test_the_owner_hands_it_to_an_admin_who_becomes_its_owner(self, market, history):
        response = hand_on(OWNER, ADMIN)

        assert response.status_code == 200, response.get_json()
        assert market.doc["roles"] == {
            OWNER.id: "admin", ADMIN.id: "owner", EDITOR.id: "editor", VIEWER.id: "viewer"}

    def test_it_answers_the_market_as_the_read_serves_it_to_the_old_owner(self, market, history):
        response = hand_on(OWNER, ADMIN)

        served = response.get_json()["market"]
        assert served["id"] == MARKET_ID
        assert served["actionRefusals"]["hand-on-market"] is not None, (
            "the old Owner, now an Admin, may no longer transfer its ownership")
        assert served["actionRefusals"]["delete-market"] is not None
        assert {(person["email"], person["role"]) for person in served["peopleWithAccess"]} >= {
            (OWNER.email, "admin"), (ADMIN.email, "owner")}

    def test_the_new_owner_may_then_delete_it_manage_admins_and_hand_it_on(self, market, history):
        hand_on(OWNER, ADMIN)

        served = signed_in_as(ADMIN).get(f"/markets/{MARKET_ID}").get_json()["market"]

        for row in ("delete-market", "manage-admins", "change-the-table", "hand-on-market"):
            assert served["actionRefusals"][row] is None, row

    def test_the_write_holds_both_roles_as_read_and_sets_only_theirs(self, market, history):
        hand_on(OWNER, EDITOR)

        (query, update), = market.writes
        assert query["roles.user-owner"] == "owner"
        assert query["roles.user-editor"] == "editor"
        assert "roles" not in query, "the whole map is not held"
        assert update == {"$set": {"roles.user-owner": "admin", "roles.user-editor": "owner"}}

    def test_an_organization_member_with_no_market_role_becomes_its_owner(self, market, history):
        response = hand_on(OWNER, ORG_MEMBER)

        assert response.status_code == 200, response.get_json()
        assert market.doc["roles"][ORG_MEMBER.id] == "owner"
        assert market.doc["roles"][OWNER.id] == "admin"
        (query, _update), = market.writes
        assert query["roles.user-org-member"] == {"$exists": False}

    def test_the_organizations_owner_with_no_market_role_becomes_its_owner(self, market, history):
        response = hand_on(OWNER, ORG_OWNER)

        assert response.status_code == 200, response.get_json()
        assert market.doc["roles"][ORG_OWNER.id] == "owner"

    def test_an_archived_market_is_handed_on(self, monkeypatch, organization, history):
        markets = install_market(monkeypatch, MarketPhase.ARCHIVED)

        response = hand_on(OWNER, VIEWER)

        assert response.status_code == 200, response.get_json()
        assert markets.doc["roles"][VIEWER.id] == "owner"
        assert markets.doc["roles"][OWNER.id] == "admin"

    def test_the_history_records_who_handed_it_to_whom(self, market, history):
        hand_on(OWNER, ADMIN)

        entry, = entries(history)
        assert entry["actor"] == OWNER.email
        assert entry["action"] == "hand-on-market"
        assert entry["kind"] == History.HANDED_ON
        assert entry["subject"] == {"user_id": ADMIN.id, "email": ADMIN.email}
        assert entry["detail"] == {
            "before": {"owner": OWNER.email}, "after": {"owner": ADMIN.email}}


class TestWhoMayHandItOn:
    @pytest.mark.parametrize("requester", [ADMIN, EDITOR, VIEWER, ORG_OWNER, ORG_MEMBER, STRANGER],
                             ids=lambda person: person.id)
    def test_anyone_but_the_owner_is_refused_by_the_rows_sentence(
            self, market, history, requester):
        response = hand_on(requester, EDITOR if requester is not EDITOR else VIEWER)

        assert response.status_code == 403, response.get_json()
        assert response.get_json() == ONLY_THE_OWNER
        assert market.writes == []
        assert entries(history) == []


class TestToWhom:
    def test_someone_without_access_is_refused(self, market, history):
        response = hand_on(OWNER, STRANGER)

        assert response.status_code == 400
        assert response.get_json() == ONLY_TO_SOMEONE_WITH_ACCESS
        assert market.writes == []
        assert entries(history) == []

    def test_an_id_with_no_account_is_refused_alike(self, market, history):
        response = signed_in_as(OWNER).post(
            f"/markets/{MARKET_ID}/hand-on", json={"userId": "user-nobody"})

        assert response.status_code == 400
        assert response.get_json() == ONLY_TO_SOMEONE_WITH_ACCESS
        assert market.writes == []

    def test_the_owner_themselves_is_refused(self, market, history):
        response = hand_on(OWNER, OWNER)

        assert response.status_code == 400
        assert response.get_json() == ONLY_TO_SOMEONE_WITH_ACCESS
        assert market.doc["roles"][OWNER.id] == "owner"
        assert market.writes == []

    @pytest.mark.parametrize("body", [{}, {"userId": None}, {"userId": 7}, {"userId": ""},
                                      {"userId": ["user-admin"]}, {"userId": {"$ne": ""}}],
                             ids=["none", "null", "a number", "empty", "a list", "an operator"])
    def test_a_body_without_a_string_user_id_is_refused(self, market, history, body):
        response = signed_in_as(OWNER).post(f"/markets/{MARKET_ID}/hand-on", json=body)

        assert response.status_code == 400
        assert response.get_json() == CHOOSE_WHO
        assert market.writes == []

    def test_a_missing_market_is_not_found(self, market, history):
        response = hand_on(OWNER, ADMIN, market_id="market-missing")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}


class TestAMarketThatChanged:
    def test_a_second_hand_on_on_the_same_read_is_refused(self, market, history):
        # The Owner transfers it to the Admin from one tab; between the other tab's read and its write
        # the first lands, so the second meets the Owner's role changed and stores nothing.
        market.before_write = lambda: MarketsApi.hand_on_market(MARKET_ID, ADMIN.id, OWNER.email)

        response = hand_on(OWNER, EDITOR)

        assert response.status_code == 409, response.get_json()
        assert response.get_json() == {"error": MARKET_CHANGED, "code": "market_changed"}
        assert market.doc["roles"] == {
            OWNER.id: "admin", ADMIN.id: "owner", EDITOR.id: "editor", VIEWER.id: "viewer"}
        assert [entry["subject"]["email"] for entry in entries(history)] == [ADMIN.email]

    def test_a_hand_on_meeting_the_new_owners_role_changed_is_refused(self, market, history):
        market.before_write = lambda: market.doc["roles"].__setitem__(EDITOR.id, "viewer")

        response = hand_on(OWNER, EDITOR)

        assert response.status_code == 409, response.get_json()
        assert market.doc["roles"][OWNER.id] == "owner"
        assert market.doc["roles"][EDITOR.id] == "viewer"
        assert entries(history) == []
