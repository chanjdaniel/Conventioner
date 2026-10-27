"""The remember-me cookie carries the session cookie's settings.

Signing in sets two cookies: the session, and the remember-me cookie that signs the account back
in once the session has lapsed. The app and the API are on different hosts, so both are
``SameSite=None``, which a browser accepts only on a ``Secure`` cookie, and both are ``HttpOnly``
so that no script on the page reads them.
"""
import os
import sys

import pytest

from conftest import skip_without_real_dependencies

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

skip_without_real_dependencies()

import app as app_module
import api.users as UsersApi


FIXTURE_EMAIL = "fixture-user@example.com"
FIXTURE_PASSWORD = "fixture-password-1"


class UsersByAddress:
    """A users collection holding one account, found by its address."""

    def __init__(self, doc):
        self.doc = dict(doc)

    def find_one(self, query):
        if all(self.doc.get(key) == value for key, value in query.items()):
            return dict(self.doc)
        return None


@pytest.fixture
def users(monkeypatch):
    collection = UsersByAddress({
        "id": "fixture-user-id",
        "email": FIXTURE_EMAIL,
        "password": app_module.bcrypt.generate_password_hash(FIXTURE_PASSWORD).decode("utf-8"),
        "organizations": [],
        "email_verified": True,
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


def _sign_in(client):
    response = client.post("/login", json={"email": FIXTURE_EMAIL, "password": FIXTURE_PASSWORD})
    assert response.status_code == 200
    return response


@pytest.mark.parametrize("cookie", ["remember_token", "session"])
def test_signing_in_sets_the_cookie_secure_samesite_none_and_httponly(client, users, cookie):
    attributes = _set_cookie(_sign_in(client), cookie)

    assert "secure" in attributes
    assert "samesite=none" in attributes
    assert "httponly" in attributes
