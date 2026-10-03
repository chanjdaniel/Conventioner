"""Whoever creates a market owns it, whatever the request says (bug 46).

`POST /markets` took the owner from the request body and only counted that there was one, so a
client could create a market owned by another user, or by an id that is nobody - which then sat in
the creator's organization with no one able to manage it.
"""
from types import SimpleNamespace

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import app as app_module
import api.markets as MarketsApi
import api.users as UsersApi

OWNER_EMAIL = "owner@example.com"


@pytest.fixture
def created(monkeypatch):
    """Sign in, and capture the market ``create_market`` is handed instead of storing it."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    monkeypatch.setattr(
        UsersApi, "get_user",
        lambda email: SimpleNamespace(
            id="user-1", email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        ) if email == OWNER_EMAIL else None,
    )
    monkeypatch.setattr(MarketsApi, "organization_refusal", lambda *_args: None)
    seen = []

    def create_market(market, owner_email):
        seen.append(market)
        return None, "market-1"

    monkeypatch.setattr(MarketsApi, "create_market", create_market)
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER_EMAIL
        session["_fresh"] = True
    return client, seen


@pytest.mark.parametrize("roles", [
    {"someone-else": "owner"},
    {"undefined": "owner"},
    {"user-1": "viewer", "someone-else": "owner"},
    {},
])
def test_the_body_cannot_say_who_owns_the_market(created, roles):
    client, seen = created

    response = client.post("/markets", json={
        "name": "Spring Market", "creationDate": "2026-01-01", "organizationId": "org-1",
        "roles": roles, "modificationList": [], "assignmentObject": {},
    })

    assert response.status_code == 201, response.get_json()
    assert seen[0].roles == {"user-1": "owner"}
