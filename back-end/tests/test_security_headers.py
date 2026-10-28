"""Every answer the API gives carries the standard security headers.

``X-Content-Type-Options: nosniff`` keeps a browser from reading a JSON answer as something it can
run, and ``Referrer-Policy: no-referrer`` keeps the API's own addresses, which can carry a market's
id, out of anything it links to. One ``after_request`` adds them, so a route added later, an error
answer and a CORS preflight carry them without doing anything.
"""

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import app as app_module
from api import markets as MarketsApi
from utils.security_headers import SECURITY_HEADERS

# The suite's app answers the loopback origins, as a local development one does.
APP_ORIGIN = "http://127.0.0.1:5173"


class _Database:
    def command(self, name):
        return {"ok": 1}


class _Collection:
    database = _Database()


@pytest.fixture
def client():
    return app_module.app.test_client()


def assert_secure(response):
    for name, value in SECURITY_HEADERS.items():
        assert response.headers.get(name) == value, name


def test_the_headers_are_the_standard_ones():
    assert SECURITY_HEADERS == {
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
    }


def test_a_json_answer_carries_them(client, monkeypatch):
    monkeypatch.setattr(MarketsApi, "markets_collection", _Collection())

    response = client.get("/healthz")

    assert response.status_code == 200
    assert_secure(response)


def test_a_refusal_carries_them(client):
    response = client.get("/markets")

    assert response.status_code == 401
    assert_secure(response)


def test_an_unknown_address_carries_them(client):
    response = client.get("/no-such-route")

    assert response.status_code == 404
    assert_secure(response)


def test_a_cors_preflight_carries_them_and_is_still_answered(client):
    response = client.options(
        "/markets",
        headers={"Origin": APP_ORIGIN, "Access-Control-Request-Method": "POST"},
    )

    assert response.headers.get("Access-Control-Allow-Origin") == APP_ORIGIN
    assert_secure(response)
