"""A value read from a request body reaches a query only as a string.

A JSON body can carry an object or a list where a string belongs, and PyMongo hands such a value
to the database as part of the filter, where it is read as query syntax rather than as the value
the caller was asked for. So every endpoint that looks something up by a value from the body
refuses one that is not a string: the same 400 a missing value gets, or the endpoint's own
oracle-free answer where it has one, and never a query.

The users collection here matches the way the database does, operators included, so a lookup
that lets a non-string through finds what the database would find.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from conftest import FakeMarketsCollection, skip_without_real_dependencies, stored_market

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.markets as MarketsApi
import api.users as UsersApi
from datatypes import MarketPhase


FIXTURE_EMAIL = "fixture-user@example.com"
FIXTURE_PASSWORD = "fixture-password-1"
NEW_PASSWORD = "fixture-password-2"

NOT_STRINGS = [{"$ne": None}, ["a-token"], 12345, True]
# A list whose text holds an address, which ``str()`` would have turned into one.
NOT_AN_ADDRESS = [*NOT_STRINGS, [FIXTURE_EMAIL]]


def _matches(value, condition):
    """Whether a stored value meets one filter term: an equality, or a ``$ne`` operator."""
    if isinstance(condition, dict) and any(key.startswith("$") for key in condition):
        unknown = set(condition) - {"$ne"}
        assert not unknown, f"the fake does not implement {unknown}"
        return value != condition["$ne"]
    return value == condition


class UsersLikeTheDatabase:
    """The users collection, matching equality and ``$ne`` as the database does."""

    def __init__(self, docs):
        self.docs = [dict(doc) for doc in docs]

    def _first(self, query):
        return next(
            (doc for doc in self.docs
             if all(_matches(doc.get(key), condition) for key, condition in query.items())),
            None,
        )

    def find_one(self, query):
        doc = self._first(query)
        return dict(doc) if doc else None

    def update_one(self, query, update):
        doc = self._first(query)
        if doc:
            doc.update(update.get("$set", {}))

    def by_email(self, email):
        return next(doc for doc in self.docs if doc["email"] == email)


def _in_an_hour():
    return (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()


@pytest.fixture
def users(monkeypatch):
    def _install(**fields):
        doc = {
            "id": "fixture-user-id",
            "email": FIXTURE_EMAIL,
            "password": app_module.bcrypt.generate_password_hash(FIXTURE_PASSWORD).decode("utf-8"),
            "organizations": [],
            "email_verified": True,
            "verification_token": None,
            "verification_token_expires": None,
            "password_reset_token": None,
            "password_reset_token_expires": None,
            "otp": None,
            "otp_expires": None,
            "otp_attempts": 0,
        }
        doc.update(fields)
        collection = UsersLikeTheDatabase([doc])
        monkeypatch.setattr(UsersApi, "users_collection", collection)
        return collection
    return _install


@pytest.fixture
def client():
    return app_module.app.test_client()


def _password_is(collection, password):
    stored = collection.by_email(FIXTURE_EMAIL)["password"]
    return app_module.bcrypt.check_password_hash(stored, password)


class TestResetPassword:
    @pytest.mark.parametrize("token", NOT_STRINGS)
    def test_a_token_that_is_not_a_string_is_refused_and_changes_no_password(
        self, client, users, token,
    ):
        collection = users(
            password_reset_token="a-live-reset-token",
            password_reset_token_expires=_in_an_hour(),
        )

        response = client.post(
            "/reset-password", json={"token": token, "new_password": NEW_PASSWORD},
        )

        assert response.status_code == 400
        assert _password_is(collection, FIXTURE_PASSWORD)

    def test_the_live_token_still_resets_the_password(self, client, users):
        collection = users(
            password_reset_token="a-live-reset-token",
            password_reset_token_expires=_in_an_hour(),
        )

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
            verification_token="a-live-verification-token",
            verification_token_expires=_in_an_hour(),
        )

        response = client.post("/verify-email", json={"token": token})

        assert response.status_code == 400
        assert collection.by_email(FIXTURE_EMAIL)["email_verified"] is False

    def test_the_live_token_still_verifies_the_address(self, client, users):
        collection = users(
            email_verified=False,
            verification_token="a-live-verification-token",
            verification_token_expires=_in_an_hour(),
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
        collection = users(otp="123456", otp_expires=_in_an_hour())

        response = client.post("/login-otp", json={"email": FIXTURE_EMAIL, "otp": otp})

        assert response.status_code == 400
        assert collection.by_email(FIXTURE_EMAIL)["otp_attempts"] == 0


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


class TestRegistration:
    @pytest.mark.parametrize("path", ["/register-user", "/register"])
    @pytest.mark.parametrize("field", ["email", "password"])
    @pytest.mark.parametrize("value", NOT_STRINGS)
    def test_a_credential_that_is_not_a_string_is_refused(self, client, users, path, field, value):
        users()
        body = {
            "email": "someone-new@example.com", "password": NEW_PASSWORD,
            "captcha_token": "a-captcha-token", field: value,
        }

        response = client.post(path, json=body)

        assert response.status_code == 400


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


class TestTheCheckInPage:
    """A vendor's check-in, and its undo, by the address and date in the body."""

    CHECK_IN = "/public/markets/a-market/attendance/checkin"

    @pytest.fixture(autouse=True)
    def a_published_market(self, monkeypatch):
        import api.attendance as AttendanceApi

        monkeypatch.setattr(
            AttendanceApi, "get_published_market_by_slug", lambda _slug: {"id": "a-market-id"},
        )

    @pytest.mark.parametrize("method", ["POST", "DELETE"])
    @pytest.mark.parametrize("field", ["vendorEmail", "date"])
    @pytest.mark.parametrize("value", NOT_AN_ADDRESS)
    def test_an_address_or_date_that_is_not_a_string_is_refused(
        self, client, market_records, method, field, value,
    ):
        body = {"vendorEmail": FIXTURE_EMAIL, "date": "2026-11-14", field: value}

        response = client.open(self.CHECK_IN, method=method, json=body)

        assert response.status_code == 400
        assert market_records.attendance.documents == []

    @pytest.mark.parametrize("method", ["POST", "DELETE"])
    def test_a_body_that_is_not_an_object_is_refused(self, client, method):
        response = client.open(self.CHECK_IN, method=method, json=[FIXTURE_EMAIL, "2026-11-14"])

        assert response.status_code == 400


class TestTheFloorplanTools:
    """Two floorplan writes name what they act on by an id in the body."""

    @pytest.fixture
    def signed_in(self, monkeypatch):
        monkeypatch.setattr(app_module.login_manager, "session_protection", None)
        monkeypatch.setattr(
            UsersApi, "get_user",
            lambda email: SimpleNamespace(
                id="fixture-user-id", email=email, is_active=True, is_authenticated=True,
                is_anonymous=False, get_id=lambda e=email: e,
            ),
        )
        monkeypatch.setattr(
            MarketsApi, "markets_collection", FakeMarketsCollection(stored_market(MarketPhase.DRAFT)),
        )
        client = app_module.app.test_client()
        with client.session_transaction() as session:
            session["_user_id"] = FIXTURE_EMAIL
            session["_fresh"] = True
        return client

    @pytest.mark.parametrize("market_id", NOT_STRINGS)
    def test_saving_to_a_market_named_by_anything_but_a_string_is_refused(
        self, signed_in, market_id,
    ):
        response = signed_in.post(
            "/floorplans/save-to-market", json={"market_id": market_id, "floorplan": {"a": 1}},
        )

        assert response.status_code == 400

    @pytest.mark.parametrize("gridfs_id", NOT_STRINGS)
    def test_analysing_an_image_named_by_anything_but_a_string_is_refused(
        self, signed_in, gridfs_id,
    ):
        response = signed_in.post("/floorplans/analyze", json={"gridfs_id": gridfs_id})

        assert response.status_code == 400
