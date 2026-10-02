"""The token an applicant holds after signing in: who they are, and where (E26/F07/S01).

It named an application, and was issued only to an address that already had one, so a vendor who
had never applied could prove their address and still be turned away (bug 6).
"""
import time

import jwt
import pytest

from utils.application_token import generate_application_token, verify_application_token
from utils.secret_key import signing_secret


@pytest.fixture(autouse=True)
def a_secret(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "a-test-signing-secret-that-is-long-enough-for-hs256")


def test_it_names_the_market_and_the_address_and_no_application():
    payload = verify_application_token(generate_application_token("market-1", "v@example.com"))

    assert payload["market_id"] == "market-1"
    assert payload["email"] == "v@example.com"
    assert "application_id" not in payload


@pytest.mark.parametrize("missing", ["market_id", "email"])
def test_a_token_that_does_not_say_who_and_where_is_refused(missing):
    claims = {"market_id": "market-1", "email": "v@example.com", "exp": int(time.time()) + 60}
    del claims[missing]

    assert verify_application_token(jwt.encode(claims, signing_secret(), algorithm="HS256")) is None


def test_an_expired_token_is_refused():
    claims = {"market_id": "market-1", "email": "v@example.com", "exp": int(time.time()) - 1}

    assert verify_application_token(jwt.encode(claims, signing_secret(), algorithm="HS256")) is None


def test_a_token_signed_with_another_key_is_refused():
    claims = {"market_id": "market-1", "email": "v@example.com", "exp": int(time.time()) + 60}

    assert verify_application_token(jwt.encode(claims, "not-our-key-" * 4, algorithm="HS256")) is None
