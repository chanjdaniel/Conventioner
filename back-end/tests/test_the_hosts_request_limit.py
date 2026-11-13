"""The back end holds a request body to the host's limit, and answers a larger one with a sentence
(T315 08).

Production's functions refuse a request body over 4.5 MB before Flask sees it, while the back end's
own limit was 50 MB, so a local stack took what production refuses, and a body over the back end's
limit was answered by werkzeug's HTML page, which no screen reads. The browser refuses a responses
file too large to send before it is sent; this is the server's side of the same limit.
"""
import json
from types import SimpleNamespace

import pytest

from conftest import (
    FakeMarketsCollection,
    sessions_load_through_get_user,
    skip_without_real_dependencies,
    stored_market,
)

skip_without_real_dependencies()

import app as app_module
import api.markets as MarketsApi
import api.users as UsersApi
import csv_import as CsvImport
import host_limits
from datatypes import MarketPhase

OWNER_EMAIL = "owner@example.com"
OWNER_ID = "user-1"
IMPORT_ROUTES = [
    "/markets/market-123/applications/import/inspect",
    "/markets/market-123/applications/import/preview",
    "/markets/market-123/applications/import",
]


@pytest.fixture
def client(monkeypatch):
    """Signed in as the owner of a CSV market taking applications, which the import takes."""
    monkeypatch.setattr(app_module.login_manager, "session_protection", None)
    sessions_load_through_get_user(monkeypatch)
    monkeypatch.setattr(
        UsersApi, "get_user",
        lambda email: SimpleNamespace(
            id=OWNER_ID, email=email, is_active=True, is_authenticated=True,
            is_anonymous=False, get_id=lambda e=email: e,
        ) if email == OWNER_EMAIL else None,
    )
    monkeypatch.setattr(
        MarketsApi, "markets_collection",
        FakeMarketsCollection(stored_market(MarketPhase.APPLICATIONS, intakeMode="csv")),
    )
    client = app_module.app.test_client()
    with client.session_transaction() as session:
        session["_user_id"] = OWNER_EMAIL
        session["_fresh"] = True
    return client


@pytest.fixture
def inspected(monkeypatch):
    """The CSV texts the inspect was asked to read."""
    texts = []

    def inspect(_market_doc, csv_content):
        texts.append(csv_content)
        return {"headers": []}, 200

    monkeypatch.setattr(CsvImport, "inspect", inspect)
    return texts


def _body_of(size: int) -> bytes:
    """A JSON body of exactly ``size`` bytes, its ``csvContent`` a synthetic file padded to fit."""
    empty = json.dumps({"csvContent": ""}).encode()
    return json.dumps({"csvContent": "a" * (size - len(empty))}).encode()


def test_the_limit_is_the_hosts():
    """Vercel's 4.5 MB, read as decimal, the lower of its two readings."""
    assert host_limits.MAX_REQUEST_BODY_BYTES == 4_500_000
    assert app_module.app.config["MAX_CONTENT_LENGTH"] == host_limits.MAX_REQUEST_BODY_BYTES


@pytest.mark.parametrize("path", IMPORT_ROUTES)
def test_a_body_over_the_limit_is_refused_with_a_sentence(client, inspected, path):
    body = _body_of(host_limits.MAX_REQUEST_BODY_BYTES + 1)
    assert len(body) == host_limits.MAX_REQUEST_BODY_BYTES + 1

    response = client.post(path, data=body, content_type="application/json")

    assert response.status_code == 413
    assert response.get_json() == {
        "error": "This was larger than the 4.5 MB one request can carry.",
    }
    assert response.get_json() == {"error": host_limits.REQUEST_TOO_LARGE}
    assert inspected == []


def test_a_body_at_the_limit_is_read(client, inspected):
    body = _body_of(host_limits.MAX_REQUEST_BODY_BYTES)
    assert len(body) == host_limits.MAX_REQUEST_BODY_BYTES

    response = client.post(IMPORT_ROUTES[0], data=body, content_type="application/json")

    assert response.status_code == 200
    assert inspected == [json.loads(body)["csvContent"]]
