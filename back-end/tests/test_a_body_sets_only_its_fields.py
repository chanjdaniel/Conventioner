"""A request body sets only the fields its handler names, of the types it names.

A JSON body may carry any key, and any JSON value under it. A handler that writes the body's keys as
they came lets a caller set what the server owns: a new account's organizations, an organization's
owner, members or markets. So each write here takes the fields it is for and nothing else, and a
body that is not a JSON object is refused with a 400 before any value is read from it.
"""
import os
import sys
from types import SimpleNamespace

import pytest

from conftest import (
    FakeMarketsCollection,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
    stored_market,
)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.users as UsersApi
from datatypes import MarketPhase


FIXTURE_EMAIL = "fixture-user@example.com"
FIXTURE_PASSWORD = "fixture-password-1"
OWNER_ID = "fixture-user-id"
ORG_ID = "org-1"

NOT_OBJECTS = [[{"email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD}], "a body", 12345, True]


class FakeUsers:
    def __init__(self):
        self.docs = []

    def find_one(self, query):
        return next(
            (dict(d) for d in self.docs if all(d.get(k) == v for k, v in query.items())), None,
        )

    def insert_one(self, doc):
        self.docs.append(dict(doc))
        return SimpleNamespace(inserted_id=len(self.docs))

    def update_one(self, query, update):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                doc.update(update.get("$set", {}))
                return


@pytest.fixture
def users(monkeypatch):
    collection = FakeUsers()
    monkeypatch.setattr(UsersApi, "users_collection", collection)
    return collection


@pytest.fixture
def client():
    return app_module.app.test_client()


@pytest.fixture
def signed_in(monkeypatch):
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(
        UsersApi, "get_user",
        lambda email: SimpleNamespace(
            id=OWNER_ID, email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        ),
    )
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = FIXTURE_EMAIL
        session["_fresh"] = True
    return client


@pytest.fixture
def captcha_passes(monkeypatch):
    monkeypatch.setattr(UsersApi, "verify_recaptcha", lambda *_a: (True, 0.9))
    monkeypatch.setattr(UsersApi, "send_verification_email", lambda *_a: True)


class TestANewAccount:
    def test_registering_starts_the_account_in_no_organization(self, client, users):
        response = client.post("/register-user", json={
            "email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD, "organizations": [ORG_ID],
        })

        assert response.status_code == 201
        [stored] = users.docs
        assert stored["organizations"] == []

    def test_registering_with_a_captcha_starts_the_account_in_no_organization(
        self, client, users, captcha_passes,
    ):
        response = client.post("/register", json={
            "email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD, "captcha_token": "t",
            "organizations": [ORG_ID],
        })

        assert response.status_code == 201
        [stored] = users.docs
        assert stored["organizations"] == []

    def test_signing_in_reads_back_no_organization_the_registration_named(self, client, users):
        client.post("/register-user", json={
            "email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD, "organizations": [ORG_ID],
        })
        users.docs[0]["email_verified"] = True

        response = client.post(
            "/login", json={"email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD},
        )

        assert response.status_code == 200
        assert response.get_json()["user_data"]["organizations"] == []

    @pytest.mark.parametrize("path", ["/register-user", "/register"])
    @pytest.mark.parametrize("body", NOT_OBJECTS)
    def test_a_body_that_is_not_an_object_is_refused(
        self, client, users, captcha_passes, path, body,
    ):
        response = client.post(path, json=body)

        assert response.status_code == 400
        assert users.docs == []


class FakeOrganizations:
    def __init__(self, doc):
        self.doc = dict(doc)
        self.sets = []

    def find_one(self, query):
        return dict(self.doc) if all(self.doc.get(k) == v for k, v in query.items()) else None

    def update_one(self, query, update):
        self.sets.append(update["$set"])
        self.doc.update(update["$set"])
        return SimpleNamespace(modified_count=1)


class TestAnOrganizationUpdate:
    @pytest.fixture
    def organization(self, monkeypatch):
        collection = FakeOrganizations({
            "id": ORG_ID, "name": "Night Market Society", "owner": OWNER_ID,
            "admins": [], "members": [], "markets": ["market-1"], "theme": None,
        })
        monkeypatch.setattr(OrgsApi, "organizations_collection", collection)
        return collection

    def test_it_changes_only_the_name(self, signed_in, organization):
        response = signed_in.put(f"/organizations/{ORG_ID}", json={
            "name": "  Renamed  ",
            "owner": "someone-else",
            "admins": ["someone-else"],
            "members": ["someone-else"],
            "markets": [],
            "theme": {"primary_color": "#000000", "secondary_color": "#ffffff"},
            "$where": "1",
        })

        assert response.status_code == 200
        assert organization.sets == [{"name": "Renamed"}]

    @pytest.mark.parametrize("name", [{"$ne": None}, ["Renamed"], 12345, True, None, "   "])
    def test_a_name_that_is_not_a_string_or_is_blank_is_refused(
        self, signed_in, organization, name,
    ):
        response = signed_in.put(f"/organizations/{ORG_ID}", json={"name": name})

        assert response.status_code == 400
        assert response.get_json() == {"error": "Organization name required"}
        assert organization.sets == []

    def test_a_body_without_a_name_changes_nothing(self, signed_in, organization):
        response = signed_in.put(f"/organizations/{ORG_ID}", json={"members": ["someone-else"]})

        assert response.status_code == 400
        assert organization.sets == []


class TestAFloorplanSave:
    @pytest.fixture(autouse=True)
    def a_market(self, monkeypatch):
        monkeypatch.setattr(
            MarketsApi, "markets_collection",
            FakeMarketsCollection(stored_market(MarketPhase.DRAFT)),
        )

    @pytest.mark.parametrize("body", [
        [{"market_id": "market-123", "floorplan": {"a": 1}}], "a body", 12345, True,
    ])
    def test_a_body_that_is_not_an_object_is_refused(self, signed_in, body):
        response = signed_in.post("/floorplans/save-to-market", json=body)

        assert response.status_code == 400
