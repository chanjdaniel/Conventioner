"""The remember-me cookie carries the session cookie's settings, and a password reset ends both.

Signing in sets two cookies: the session, and the remember-me cookie that signs the account back
in once the session has lapsed. The app and the API are on different hosts, so both are
``SameSite=None``, which a browser accepts only on a ``Secure`` cookie, and both are ``HttpOnly``
so that no script on the page reads them.

Both name the account by its login id, not its address, and a password reset replaces the login
id: every session and remember-me cookie issued before the reset stops signing in.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

from conftest import mongo_matches, mongo_project, skip_without_real_dependencies

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.users as UsersApi


FIXTURE_EMAIL = "fixture-user@example.com"
FIXTURE_PASSWORD = "fixture-password-1"
NEW_PASSWORD = "fixture-password-2"
RESET_TOKEN = "fixture-reset-token"
FIXTURE_OTP = "123456"


class OneAccount:
    """A users collection holding one account, read and written the way Mongo does."""

    def __init__(self, doc):
        self.doc = dict(doc)
        # Runs before the next update lands, as a concurrent request would.
        self.before_next_update = None

    def find_one(self, query, projection=None):
        if mongo_matches(self.doc, query):
            return mongo_project(dict(self.doc), projection)
        return None

    def update_one(self, query, update):
        if self.before_next_update:
            self.before_next_update, run = None, self.before_next_update
            run()
        if mongo_matches(self.doc, query):
            self.doc.update(update["$set"])


def _in_an_hour():
    return (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()


@pytest.fixture
def users(monkeypatch):
    collection = OneAccount({
        "id": "fixture-user-id",
        "email": FIXTURE_EMAIL,
        "password": app_module.bcrypt.generate_password_hash(FIXTURE_PASSWORD).decode("utf-8"),
        "organizations": [],
        "email_verified": True,
        "password_reset_token": RESET_TOKEN,
        "password_reset_token_expires": _in_an_hour(),
        "otp": FIXTURE_OTP,
        "otp_expires": _in_an_hour(),
        "otp_attempts": 0,
    })
    monkeypatch.setattr(UsersApi, "users_collection", collection)
    return collection


@pytest.fixture
def client():
    return app_module.app.test_client()


def _set_cookie(response, name):
    """The attributes of the ``Set-Cookie`` header for one cookie, lower-cased."""
    headers = [
        header for header in response.headers.getlist("Set-Cookie")
        if header.startswith(f"{name}=")
    ]
    assert len(headers) == 1, f"expected one {name} cookie, got {headers}"
    return [part.strip().lower() for part in headers[0].split(";")[1:]]


def _sign_in(client, password=FIXTURE_PASSWORD):
    response = client.post("/login", json={"email": FIXTURE_EMAIL, "password": password})
    assert response.status_code == 200
    return response


def _holding_only_the_remember_cookie(client):
    """A fresh client, as a browser that kept the remember-me cookie after its session lapsed."""
    fresh = app_module.app.test_client()
    fresh.set_cookie("remember_token", client.get_cookie("remember_token").value)
    return fresh


def _reset_the_password():
    response = app_module.app.test_client().post(
        "/reset-password", json={"token": RESET_TOKEN, "new_password": NEW_PASSWORD})
    assert response.status_code == 200


@pytest.mark.parametrize("cookie", ["remember_token", "session"])
def test_signing_in_sets_the_cookie_secure_samesite_none_and_httponly(client, users, cookie):
    attributes = _set_cookie(_sign_in(client), cookie)

    assert "secure" in attributes
    assert "samesite=none" in attributes
    assert "httponly" in attributes


def test_the_remember_cookie_signs_a_fresh_client_in(client, users):
    _sign_in(client)

    assert _holding_only_the_remember_cookie(client).get("/check-session").status_code == 200


def test_a_password_reset_ends_every_session_and_remember_cookie_issued_before_it(client, users):
    _sign_in(client)
    remembered = _holding_only_the_remember_cookie(client)

    _reset_the_password()

    assert remembered.get("/check-session").status_code == 401
    assert client.get("/check-session").status_code == 401


def test_signing_in_after_a_reset_works_at_once(users):
    _sign_in(app_module.app.test_client())
    _reset_the_password()

    client = app_module.app.test_client()
    _sign_in(client, NEW_PASSWORD)

    assert client.get("/check-session").status_code == 200
    assert _holding_only_the_remember_cookie(client).get("/check-session").status_code == 200


def _sign_in_with_the_code(client):
    response = client.post("/login-otp", json={"email": FIXTURE_EMAIL, "otp": FIXTURE_OTP})
    assert response.status_code == 200
    return response


@pytest.mark.parametrize("sign_in", [_sign_in, _sign_in_with_the_code], ids=["password", "code"])
def test_an_account_without_a_login_id_gets_one_at_its_first_sign_in_and_keeps_it(users, sign_in):
    assert "login_id" not in users.doc

    sign_in(app_module.app.test_client())
    login_id = users.doc["login_id"]
    _sign_in(app_module.app.test_client())

    assert isinstance(login_id, str) and len(login_id) >= 32
    assert users.doc["login_id"] == login_id


def test_two_first_sign_ins_at_once_agree_on_the_login_id(client, users):
    # The other sign-in writes its login id between this one's read and its write.
    users.before_next_update = lambda: users.doc.update(login_id="the-other-sign-in")
    _sign_in(client)

    assert users.doc["login_id"] == "the-other-sign-in"
    assert client.get("/check-session").status_code == 200


@pytest.mark.parametrize("held", ["login-id", "address"])
def test_a_session_names_the_account_by_its_login_id_not_its_address(
    monkeypatch, client, users, held
):
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    users.doc["login_id"] = "fixture-login-id"
    with client.session_transaction() as session:
        session["_user_id"] = "fixture-login-id" if held == "login-id" else FIXTURE_EMAIL
        session["_fresh"] = True

    expected = 200 if held == "login-id" else 401
    assert client.get("/check-session").status_code == expected
