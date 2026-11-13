"""Removing someone already removed elsewhere (T181, T167 rereview-3 note 6).

Two organizers open Manage organization, or Manage market, at once; one removes a person, then the
other confirms the same removal. The second removal finds the person already gone, and the server
answers it with a 404 in the E38/F11 form, saying what is true now: "They are no longer in this
organization." or "They no longer have a role on this market." It writes nothing and records
nothing, before any write or when the write finds them gone under it. Manage organization and
Manage market read that 404 as done, since the row the organizer wanted gone is gone.

The owner, only-owner and Forbidden refusals are unchanged, and a caller who may remove no one is
refused in one sentence, never told whether the person is still there, nor whether they are the
market's only owner or an Admin.

Pinned through the test client against the real app, over collections that apply the writes.
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
from test_reading_the_history import PagedHistory

ORG_ID = "org-1"
MARKET_ID = "market-123"
OWNER = SimpleNamespace(id="user-owner", email="owner@example.com")
ADMIN = SimpleNamespace(id="user-admin", email="admin@example.com")
MEMBER = SimpleNamespace(id="user-member", email="member@example.com")
GONE = SimpleNamespace(id="user-gone", email="gone@example.com")
EDITOR = SimpleNamespace(id="user-editor", email="editor@example.com")
VIEWER = SimpleNamespace(id="user-viewer", email="viewer@example.com")
STRANGER = SimpleNamespace(id="user-stranger", email="stranger@example.com")
PEOPLE = (OWNER, ADMIN, MEMBER, GONE, EDITOR, VIEWER, STRANGER)

NO_LONGER_IN_THE_ORGANIZATION = {"error": "They are no longer in this organization."}
NO_LONGER_ON_THE_MARKET = {"error": "They no longer have a role on this market."}


class Markets(FakeMarketsCollection):
    """The ``markets`` collection: one market document, its writes applied as Mongo applies them
    (``FakeMarketsCollection``), each kept in ``writes``. ``gone_under`` names a person another
    organizer takes the role of between this removal's read and its write."""

    def __init__(self, doc):
        super().__init__(doc)
        self.writes = []
        self.gone_under = None

    def find_one_and_update(self, query, update, projection=None, return_document=False):
        reject_malformed_update(update)
        self.writes.append(update)
        if self.gone_under:
            self.doc["roles"].pop(self.gone_under, None)
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
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)


@pytest.fixture
def organization(monkeypatch, people, history):
    return install_organizations(monkeypatch, FakeOrganizations({
        "id": ORG_ID, "name": "Ember Markets", "owner": OWNER.id, "admins": [ADMIN.id],
        "members": [MEMBER.id], "markets": [], "theme": None,
    }))


@pytest.fixture
def market(monkeypatch, people, history):
    markets = Markets(stored_market(
        phase=MarketPhase.APPLICATIONS,
        roles={OWNER.id: "owner", EDITOR.id: "editor", VIEWER.id: "viewer"},
    ))
    monkeypatch.setattr(MarketsApi, "markets_collection", markets)
    monkeypatch.setattr(MarketWrite, "markets_collection", markets)
    return markets


def signed_in_as(person):
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = person.email
        session["_fresh"] = True
    return client


def organization_entries(history):
    return [doc for doc in history.docs if doc.get("organization_id") == ORG_ID]


def market_entries(history):
    return [doc for doc in history.docs if doc.get(History.MARKET_ID_FIELD) == MARKET_ID]


class TestTheOrganization:
    def test_removing_a_member_removes_them(self, organization, history):
        response = signed_in_as(OWNER).delete(f"/organizations/{ORG_ID}/users/{MEMBER.id}")

        assert response.status_code == 200
        assert organization.doc["members"] == []
        assert len(organization_entries(history)) == 1

    @pytest.mark.parametrize("remover", [OWNER, ADMIN], ids=["the owner", "an admin"])
    def test_removing_someone_no_longer_in_it_is_not_found(self, organization, history, remover):
        response = signed_in_as(remover).delete(f"/organizations/{ORG_ID}/users/{GONE.id}")

        assert response.status_code == 404
        assert response.get_json() == NO_LONGER_IN_THE_ORGANIZATION
        assert organization.writes == []
        assert organization.accounts.writes == [], "nothing is written before the refusal"
        assert organization_entries(history) == []

    def test_removing_a_member_twice_answers_the_second_as_gone(self, organization, history):
        signed_in_as(OWNER).delete(f"/organizations/{ORG_ID}/users/{MEMBER.id}")

        response = signed_in_as(ADMIN).delete(f"/organizations/{ORG_ID}/users/{MEMBER.id}")

        assert response.status_code == 404
        assert response.get_json() == NO_LONGER_IN_THE_ORGANIZATION
        assert len(organization_entries(history)) == 1, "only the first removal is recorded"

    def test_someone_removed_under_the_removal_is_not_found(self, organization, history):
        # Another organizer removes them between this removal's read and its write.
        organization.before_write = lambda: organization.doc["members"].remove(MEMBER.id)

        response = signed_in_as(OWNER).delete(f"/organizations/{ORG_ID}/users/{MEMBER.id}")

        assert response.status_code == 404
        assert response.get_json() == NO_LONGER_IN_THE_ORGANIZATION
        assert organization_entries(history) == []

    def test_the_owner_is_still_refused(self, organization, history):
        response = signed_in_as(ADMIN).delete(f"/organizations/{ORG_ID}/users/{OWNER.id}")

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "They own this organization, so they can't be removed from it."}

    def test_an_admin_removing_an_admin_is_still_forbidden(self, organization, history):
        organization.doc["admins"].append(GONE.id)

        response = signed_in_as(ADMIN).delete(f"/organizations/{ORG_ID}/users/{GONE.id}")

        assert response.status_code == 403
        assert response.get_json() == {"error": "Only owner can remove admins"}
        assert GONE.id in organization.doc["admins"]

    def test_a_member_is_forbidden_before_learning_who_is_gone(self, organization, history):
        response = signed_in_as(MEMBER).delete(f"/organizations/{ORG_ID}/users/{GONE.id}")

        assert response.status_code == 403
        assert response.get_json() == {
            "error": "Only organization owner or admin can remove users"}

    def test_a_missing_organization_is_still_not_found(self, organization, history):
        response = signed_in_as(OWNER).delete(f"/organizations/org-missing/users/{MEMBER.id}")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Organization not found"}


class TestTheMarket:
    def test_taking_a_role_takes_it(self, market, history):
        response = signed_in_as(OWNER).delete(f"/markets/{MARKET_ID}/roles/{EDITOR.id}")

        assert response.status_code == 200
        assert EDITOR.id not in market.doc["roles"]
        assert len(market_entries(history)) == 1

    def test_taking_the_role_of_someone_with_none_is_not_found(self, market, history):
        response = signed_in_as(OWNER).delete(f"/markets/{MARKET_ID}/roles/{GONE.id}")

        assert response.status_code == 404
        assert response.get_json() == NO_LONGER_ON_THE_MARKET
        assert market.writes == []
        assert market_entries(history) == []

    def test_taking_a_role_twice_answers_the_second_as_gone(self, market, history):
        signed_in_as(OWNER).delete(f"/markets/{MARKET_ID}/roles/{EDITOR.id}")

        response = signed_in_as(OWNER).delete(f"/markets/{MARKET_ID}/roles/{EDITOR.id}")

        assert response.status_code == 404
        assert response.get_json() == NO_LONGER_ON_THE_MARKET
        assert len(market_entries(history)) == 1, "only the first removal is recorded"

    def test_a_role_taken_under_the_removal_is_not_found(self, market, history):
        market.gone_under = EDITOR.id

        response = signed_in_as(OWNER).delete(f"/markets/{MARKET_ID}/roles/{EDITOR.id}")

        assert response.status_code == 404
        assert response.get_json() == NO_LONGER_ON_THE_MARKET
        assert market_entries(history) == []

    def test_the_only_owner_is_still_refused(self, market, history):
        response = signed_in_as(OWNER).delete(f"/markets/{MARKET_ID}/roles/{OWNER.id}")

        assert response.status_code == 400
        assert response.get_json() == {
            "error": "The market's only Owner can't be removed. Transfer ownership first."}

    def test_a_viewer_is_still_forbidden_to_take_a_role(self, market, history):
        response = signed_in_as(VIEWER).delete(f"/markets/{MARKET_ID}/roles/{EDITOR.id}")

        assert response.status_code == 403
        assert EDITOR.id in market.doc["roles"]

    def test_a_viewer_is_forbidden_before_learning_who_has_no_role(self, market, history):
        taking = signed_in_as(VIEWER).delete(f"/markets/{MARKET_ID}/roles/{EDITOR.id}")

        response = signed_in_as(VIEWER).delete(f"/markets/{MARKET_ID}/roles/{GONE.id}")

        assert response.status_code == 403
        assert response.get_json() == taking.get_json()

    def test_a_caller_with_no_role_learns_nothing_of_who_holds_which(self, market, history):
        market.doc["roles"][ADMIN.id] = "admin"
        stranger = signed_in_as(STRANGER)

        answers = [stranger.delete(f"/markets/{MARKET_ID}/roles/{person.id}")
                   for person in (OWNER, ADMIN, EDITOR, GONE)]

        assert [answer.status_code for answer in answers] == [403] * 4
        assert all(answer.get_json() == answers[0].get_json() for answer in answers), (
            "the only owner, an Admin, an Editor and nobody read alike")
        assert market.writes == []
        assert market_entries(history) == []

    def test_a_missing_market_is_still_not_found(self, market, history):
        response = signed_in_as(OWNER).delete(f"/markets/market-missing/roles/{EDITOR.id}")

        assert response.status_code == 404
        assert response.get_json() == {"error": "Market not found"}
