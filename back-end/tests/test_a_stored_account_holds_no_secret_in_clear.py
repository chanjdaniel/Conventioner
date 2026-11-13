"""A copy of the database holds nothing that signs an account in (ADR 0026).

Each test drives the routes as an organizer would, takes every secret the mail stand-in was given
and every cookie a sign-in set, and reads every stored account and every stored sign-in
(``organizer_sessions``) whole: no value is a mailed secret or a cookie's secret, and none holds
one, but for a secret's own hash, which is hex and so may hold six digits by chance.
"""
import pytest
from flask_login.utils import decode_cookie

import app as app_module

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import api.users as UsersApi
from test_a_failed_mail_leaves_no_wait_armed import outbox  # noqa: F401
from test_the_organizer_sign_in_is_bounded import (  # noqa: F401
    ACCOUNT_EMAIL, CALLER, PASSWORD, UNVERIFIED_EMAIL, client, clock, fast_stand_in_hash,
)
from test_the_sign_in_secrets_hold_one_state import users  # noqa: F401


def _values(value, path=""):
    """Every scalar under ``value``, with the dotted path it is stored at."""
    if isinstance(value, dict):
        for key, inner in value.items():
            yield from _values(inner, f"{path}.{key}" if path else key)
    elif isinstance(value, list):
        for index, inner in enumerate(value):
            yield from _values(inner, f"{path}.{index}")
    else:
        yield path, value


def _holding(docs, secret):
    """The stored paths whose value is ``secret``, or holds it outside a secret's hash."""
    return [
        path for doc in docs for path, value in _values(doc)
        if value == secret
        or (isinstance(value, str) and secret in value and not path.endswith(".hash"))
    ]


def _cookie_secrets(client):
    """Every secret the browser holds for its sign-in: the session's, the remember cookie whole
    and the secret in it."""
    with client.session_transaction() as held:
        held_secrets = [held["_user_id"]]
    remembered = client.get_cookie(UsersApi.REMEMBER_COOKIE)
    if remembered is not None:
        with app_module.app.app_context():
            held_secrets += [remembered.value, decode_cookie(remembered.value)]
    return held_secrets


def _post(client, path, body):
    return client.post(path, json=body, environ_base={"REMOTE_ADDR": CALLER})


@pytest.mark.parametrize("remember", [False, True], ids=["unremembered", "remembered"])
def test_no_mailed_code_is_stored_in_clear(client, users, outbox, clock, remember):
    assert _post(client, "/request-otp", {"email": ACCOUNT_EMAIL}).status_code == 200
    [(_to, code)] = outbox.sent
    assert _holding(users.docs, code) == []

    signed_in = _post(client, "/login-otp",
                      {"email": ACCOUNT_EMAIL, "otp": code, "remember": remember})

    assert signed_in.status_code == 200
    assert _holding(users.docs, code) == []


@pytest.mark.parametrize("remember", [False, True], ids=["unremembered", "remembered"])
@pytest.mark.parametrize("by", ["password", "code"])
def test_no_cookies_secret_is_stored_in_clear(client, users, outbox, clock, organizer_sessions,
                                              remember, by):
    if by == "code":
        assert _post(client, "/request-otp", {"email": ACCOUNT_EMAIL}).status_code == 200
        [(_to, code)] = outbox.sent
        body = {"email": ACCOUNT_EMAIL, "otp": code, "remember": remember}
        signed_in = _post(client, "/login-otp", body)
    else:
        body = {"email": ACCOUNT_EMAIL, "password": PASSWORD, "remember": remember}
        signed_in = _post(client, "/login", body)
    assert signed_in.status_code == 200

    held_secrets = _cookie_secrets(client)
    assert len(held_secrets) == (3 if remember else 1)
    stored = users.docs + organizer_sessions.documents
    assert len(organizer_sessions.documents) == 1
    for secret in held_secrets:
        assert _holding(stored, secret) == []


@pytest.mark.parametrize("email", [ACCOUNT_EMAIL, UNVERIFIED_EMAIL], ids=["verified", "unverified"])
def test_no_mailed_reset_link_is_stored_in_clear(client, users, outbox, clock, email):
    assert _post(client, "/request-password-reset", {"email": email}).status_code == 200
    [(_to, link)] = outbox.sent
    assert _holding(users.docs, link) == []

    reset = _post(client, "/reset-password", {"token": link, "new_password": "fixture-new-pass-1"})

    assert reset.status_code == 200
    assert _holding(users.docs, link) == []


def test_no_mailed_verification_link_is_stored_in_clear(client, users, outbox, clock,
                                                         monkeypatch):
    monkeypatch.setattr(UsersApi, "verify_recaptcha", lambda *_a: (True, 0.9))
    signed_up = _post(client, "/register", {"email": "fixture-new-organizer@example.com",
                                            "password": "fixture-password-1",
                                            "captcha_token": "fixture-captcha"})
    assert signed_up.status_code == 201
    assert _post(client, "/resend-verification", {"email": UNVERIFIED_EMAIL}).status_code == 200
    [(_to, at_sign_up), (_to2, resent)] = outbox.sent
    for link in (at_sign_up, resent):
        assert _holding(users.docs, link) == []

    for link in (at_sign_up, resent):
        assert _post(client, "/verify-email", {"token": link}).status_code == 200
        assert _holding(users.docs, link) == []


def test_no_secret_of_any_kind_is_stored_in_clear_together(client, users, outbox, clock,
                                                            monkeypatch):
    """Every mail an account can be sent, asked for in turn, leaves none of them readable."""
    monkeypatch.setattr(UsersApi, "verify_recaptcha", lambda *_a: (True, 0.9))
    asked = [
        ("/register", {"email": "fixture-new-organizer@example.com",
                       "password": "fixture-password-1", "captcha_token": "fixture-captcha"}),
        ("/resend-verification", {"email": UNVERIFIED_EMAIL}),
        ("/request-password-reset", {"email": ACCOUNT_EMAIL}),
        ("/request-otp", {"email": ACCOUNT_EMAIL}),
    ]
    for path, body in asked:
        assert _post(client, path, body).status_code in (200, 201)

    assert len(outbox.sent) == len(asked)
    for _to, secret in outbox.sent:
        assert _holding(users.docs, secret) == []
