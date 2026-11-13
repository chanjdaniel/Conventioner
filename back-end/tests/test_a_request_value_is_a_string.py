"""A value read from a request body reaches a query only as a string.

A JSON body can carry an object or a list where a string belongs, and PyMongo hands such a value
to the database as part of the filter, where it is read as query syntax rather than as the value
the caller was asked for. So every endpoint that looks something up by a value from the body
refuses one that is not a string: the same 400 a missing value gets, or the endpoint's own
oracle-free answer where it has one, and never a query.

The collections here match the way the database does, operators included, so a lookup
that lets a non-string through finds what the database would find.
"""
import os
import sys
from types import SimpleNamespace

import pytest

from conftest import FakeMarketsCollection, sessions_load_through_get_user, skip_without_real_dependencies, stored_market

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.markets as MarketsApi
import api.organizations as OrgsApi
import api.users as UsersApi
from test_a_vendor_checks_in_with_the_door_code import world  # noqa: E402,F401
from datatypes import MarketPhase
from sign_in_secrets import live_code, live_link, live_verification_link, stored_code
from test_the_sign_in_secrets_hold_one_state import Users


FIXTURE_EMAIL = "fixture-user@example.com"
FIXTURE_PASSWORD = "fixture-password-1"
NEW_PASSWORD = "fixture-password-2"

NOT_STRINGS = [{"$ne": None}, ["a-token"], 12345, True]
# A list whose text holds an address, which ``str()`` would have turned into one.
NOT_AN_ADDRESS = [*NOT_STRINGS, [FIXTURE_EMAIL]]


class CollectionLikeTheDatabase(Users):
    """A collection reading and writing as the database does, operators included (the suite's
    shared matcher and update), so a lookup that lets a non-string through finds what the
    database would find."""

    def __init__(self, docs):
        super().__init__(*docs)

    def by_email(self, email):
        return next(doc for doc in self.docs if doc["email"] == email)


@pytest.fixture
def users(monkeypatch):
    def _install(**fields):
        doc = {
            "id": "fixture-user-id",
            "email": FIXTURE_EMAIL,
            "password": app_module.bcrypt.generate_password_hash(FIXTURE_PASSWORD).decode("utf-8"),
            "organizations": [],
            "email_verified": True,
        }
        doc.update(fields)
        collection = CollectionLikeTheDatabase([doc])
        monkeypatch.setattr(UsersApi, "users_collection", collection)
        return collection
    return _install


@pytest.fixture
def client():
    return app_module.app.test_client()


@pytest.fixture
def signed_in(monkeypatch):
    """A client signed in as the fixture user, for the endpoints that need a session."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(
        UsersApi, "get_user",
        lambda email: SimpleNamespace(
            id="fixture-user-id", email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        ),
    )
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = FIXTURE_EMAIL
        session["_fresh"] = True
    return client


def _password_is(collection, password):
    stored = collection.by_email(FIXTURE_EMAIL)["password"]
    return app_module.bcrypt.check_password_hash(stored, password)


class TestResetPassword:
    @pytest.mark.parametrize("token", NOT_STRINGS)
    def test_a_token_that_is_not_a_string_is_refused_and_changes_no_password(
        self, client, users, token,
    ):
        collection = users(secrets={"reset": live_link("a-live-reset-token")})

        response = client.post(
            "/reset-password", json={"token": token, "new_password": NEW_PASSWORD},
        )

        assert response.status_code == 400
        assert _password_is(collection, FIXTURE_PASSWORD)

    def test_the_live_token_still_resets_the_password(self, client, users):
        collection = users(secrets={"reset": live_link("a-live-reset-token")})

        response = client.post(
            "/reset-password", json={"token": "a-live-reset-token", "new_password": NEW_PASSWORD},
        )

        assert response.status_code == 200
        assert _password_is(collection, NEW_PASSWORD)


class TestVerifyEmail:
    @pytest.mark.parametrize("token", NOT_STRINGS)
    def test_a_token_that_is_not_a_string_is_refused_and_verifies_nobody(
        self, client, users, token,
    ):
        collection = users(
            email_verified=False,
            secrets={"verify": live_verification_link("a-live-verification-token")},
        )

        response = client.post("/verify-email", json={"token": token})

        assert response.status_code == 400
        assert collection.by_email(FIXTURE_EMAIL)["email_verified"] is False

    def test_the_live_token_still_verifies_the_address(self, client, users):
        collection = users(
            email_verified=False,
            secrets={"verify": live_verification_link("a-live-verification-token")},
        )

        response = client.post("/verify-email", json={"token": "a-live-verification-token"})

        assert response.status_code == 200
        assert collection.by_email(FIXTURE_EMAIL)["email_verified"] is True


class TestLogin:
    @pytest.mark.parametrize("field", ["email", "password"])
    @pytest.mark.parametrize("value", NOT_STRINGS)
    def test_a_credential_that_is_not_a_string_is_refused(self, client, users, field, value):
        users()
        body = {"email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD, field: value}

        response = client.post("/login", json=body)

        assert response.status_code == 400

    def test_a_missing_password_is_refused_rather_than_checked(self, client, users):
        users()

        response = client.post("/login", json={"email": FIXTURE_EMAIL})

        assert response.status_code == 400

    def test_the_right_password_still_signs_in(self, client, users):
        users()

        response = client.post(
            "/login", json={"email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD},
        )

        assert response.status_code == 200


class TestSignInCode:
    @pytest.mark.parametrize("otp", NOT_STRINGS)
    def test_a_code_that_is_not_a_string_is_refused_and_counts_no_try(self, client, users, otp):
        collection = users(secrets={"code": live_code("123456")})

        response = client.post("/login-otp", json={"email": FIXTURE_EMAIL, "otp": otp})

        assert response.status_code == 400
        assert stored_code(collection.by_email(FIXTURE_EMAIL))["tries"] == 0


class TestALookupByAddress:
    """Each of these finds an account by the address in the body."""

    @pytest.mark.parametrize("path", [
        "/request-otp", "/request-password-reset", "/resend-verification", "/login-otp",
    ])
    @pytest.mark.parametrize("email", NOT_AN_ADDRESS)
    def test_an_address_that_is_not_a_string_is_refused(self, client, users, path, email):
        users()

        response = client.post(path, json={"email": email, "otp": "123456"})

        assert response.status_code == 400


class TestDeletingYourAccount:
    @pytest.mark.parametrize("email", NOT_AN_ADDRESS)
    def test_an_address_that_is_not_a_string_is_refused_and_deletes_nobody(
        self, signed_in, users, email,
    ):
        collection = users()

        response = signed_in.post("/delete-user", json={"email": email})

        assert response.status_code == 400
        assert collection.by_email(FIXTURE_EMAIL)


class TestCreatingAnOrganization:
    """A new organization's name is looked up first, to refuse one that is taken."""

    @pytest.fixture
    def organizations(self, monkeypatch):
        collection = CollectionLikeTheDatabase([{"id": "an-org-id", "name": "Another Organization"}])
        collection.insert_one = collection.docs.append
        monkeypatch.setattr(OrgsApi, "organizations_collection", collection)
        return collection

    @pytest.mark.parametrize("name", [*NOT_STRINGS, "   "])
    def test_a_name_that_is_not_a_string_is_refused_and_creates_nothing(
        self, signed_in, organizations, name,
    ):
        response = signed_in.post("/organizations", json={"name": name})

        assert response.status_code == 400
        assert response.get_json() == {"error": "Organization name required"}
        assert len(organizations.docs) == 1


class TestNamingSomeoneForARole:
    """An organization's admin, member or new owner, and a market role and who holds it, are refused
    as missing when they are not strings, before anyone is looked up."""

    ADDRESSED = [
        ("/organizations/an-org-id/admins", "user_email", {}, OrgsApi, "add_org_admin"),
        ("/organizations/an-org-id/members", "user_email", {}, OrgsApi, "add_org_member"),
        ("/organizations/an-org-id/transfer", "new_owner_email", {},
         OrgsApi, "transfer_org_ownership"),
        ("/markets/a-market-id/roles", "user_email", {"role": "editor"},
         MarketsApi, "add_market_role"),
    ]

    @pytest.fixture
    def asked(self, monkeypatch):
        calls = []
        for *_route, api, function in self.ADDRESSED:
            monkeypatch.setattr(api, function, lambda *args, **kwargs: calls.append(args))
        monkeypatch.setattr(
            MarketsApi, "update_market_role", lambda *args, **kwargs: calls.append(args),
        )
        return calls

    @pytest.mark.parametrize("path, field, rest, _api, _function", ADDRESSED)
    @pytest.mark.parametrize("address", NOT_AN_ADDRESS)
    def test_an_address_that_is_not_a_string_is_refused(
        self, signed_in, asked, path, field, rest, _api, _function, address,
    ):
        response = signed_in.post(path, json={**rest, field: address})

        assert response.status_code == 400
        assert response.get_json()["error"].endswith("required")
        assert asked == []

    @pytest.mark.parametrize("role", NOT_STRINGS)
    def test_a_role_that_is_not_a_string_is_refused(self, signed_in, asked, role):
        added = signed_in.post(
            "/markets/a-market-id/roles", json={"user_email": FIXTURE_EMAIL, "role": role},
        )
        changed = signed_in.put("/markets/a-market-id/roles/a-user-id", json={"role": role})

        assert (added.status_code, added.get_json()) == (
            400, {"error": "user_email and role required"},
        )
        assert (changed.status_code, changed.get_json()) == (400, {"error": "role required"})
        assert asked == []


class TestRegistration:
    @pytest.mark.parametrize("field", ["email", "password"])
    @pytest.mark.parametrize("value", NOT_STRINGS)
    def test_a_credential_that_is_not_a_string_is_refused(
        self, client, users, monkeypatch, field, value,
    ):
        collection = users()
        monkeypatch.setattr(UsersApi, "verify_recaptcha", lambda *_a: (True, 0.9))
        monkeypatch.setattr(UsersApi, "send_verification_email", lambda *_a: True)
        body = {
            "email": "someone-new@example.com", "password": NEW_PASSWORD,
            "captcha_token": "a-captcha-token", field: value,
        }

        response = client.post("/register", json=body)

        assert (response.status_code, response.get_json()) == (
            400, {"msg": "Email and password required"},
        )
        assert [doc["email"] for doc in collection.docs] == [FIXTURE_EMAIL]


class TestApplicantSignIn:
    """The applicant sign-in answers a non-string as it answers a missing value: one same answer."""

    REQUEST_CODE = "/public/markets/a-market/applicant-login/request-code"
    VERIFY_CODE = "/public/markets/a-market/applicant-login/verify-code"

    @pytest.mark.parametrize("email", NOT_AN_ADDRESS)
    def test_a_code_asked_for_an_address_that_is_not_a_string_gets_the_one_answer(
        self, client, email,
    ):
        missing = client.post(self.REQUEST_CODE, json={})

        response = client.post(self.REQUEST_CODE, json={"email": email})

        assert (response.status_code, response.get_json()) == (
            missing.status_code, missing.get_json())

    @pytest.mark.parametrize("field", ["email", "code"])
    @pytest.mark.parametrize("value", NOT_AN_ADDRESS)
    def test_a_code_or_address_that_is_not_a_string_gets_the_one_failure(
        self, client, field, value,
    ):
        missing = client.post(self.VERIFY_CODE, json={})
        body = {"email": FIXTURE_EMAIL, "code": "123456", field: value}

        response = client.post(self.VERIFY_CODE, json=body)

        assert response.status_code == 401
        assert (response.status_code, response.get_json()) == (
            missing.status_code, missing.get_json())

    @pytest.mark.parametrize("path", [REQUEST_CODE, VERIFY_CODE])
    def test_a_body_that_is_not_an_object_gets_the_one_answer(self, client, path):
        missing = client.post(path, json={})

        response = client.post(path, json=["not", "an", "object"])

        assert (response.status_code, response.get_json()) == (
            missing.status_code, missing.get_json())


class TestTheVendorsOwnCheckIn:
    """A vendor's check-in on their vendor page, and its undo, by the date and door code in the
    body (ADR 0022)."""

    @pytest.mark.parametrize("field", ["date", "doorCode"])
    @pytest.mark.parametrize("value", NOT_AN_ADDRESS)
    def test_a_date_or_door_code_that_is_not_a_string_checks_nobody_in(
        self, client, vendor_door, field, value,
    ):
        body = {"date": vendor_door.TODAY, "doorCode": vendor_door.CODE, field: value}

        response = client.post(vendor_door.PATH, json=body, headers=vendor_door.signed_in())

        assert response.status_code in (403, 404)
        assert vendor_door.world.attendance.documents == []

    @pytest.mark.parametrize("value", NOT_AN_ADDRESS)
    def test_a_date_that_is_not_a_string_undoes_nothing(self, client, vendor_door, value):
        vendor_door.world.attendance.insert_one({
            "market_id": "market-123", "vendor_email": vendor_door.VENDOR,
            "date": vendor_door.TODAY, "checked_in_at": "x"})

        response = client.delete(
            vendor_door.PATH, json={"date": value}, headers=vendor_door.signed_in())

        assert response.status_code == 400
        assert len(vendor_door.world.attendance.documents) == 1

    @pytest.mark.parametrize("method", ["POST", "DELETE"])
    def test_a_body_that_is_not_an_object_is_refused(self, client, vendor_door, method):
        response = client.open(vendor_door.PATH, method=method, json=["2099-08-01", "K7M4QP"],
                               headers=vendor_door.signed_in())

        assert response.status_code == 400
        assert vendor_door.world.attendance.documents == []


@pytest.fixture
def vendor_door(world):
    """A market on its days with a door code, and a vendor seated there, signed in."""
    import test_a_vendor_checks_in_with_the_door_code as door
    return SimpleNamespace(
        world=world, PATH=door.PATH, TODAY=door.TODAY, CODE=door.CODE, VENDOR=door.VENDOR,
        signed_in=door.signed_in)


class TestTheFloorplanTools:
    """A layout's save names its market by an id in the body."""

    @pytest.fixture(autouse=True)
    def a_market(self, monkeypatch):
        monkeypatch.setattr(
            MarketsApi, "markets_collection", FakeMarketsCollection(stored_market(MarketPhase.DRAFT)),
        )

    @pytest.mark.parametrize("market_id", NOT_STRINGS)
    def test_saving_to_a_market_named_by_anything_but_a_string_is_refused(
        self, signed_in, market_id,
    ):
        response = signed_in.post(
            "/floorplans/save-to-market", json={"market_id": market_id, "floorplan": {"a": 1}},
        )

        assert response.status_code == 400
