"""A copy of the database holds nothing that signs an account in (ADR 0026).

Each test drives the routes as an organizer would, takes every secret the mail stand-in was given,
and reads every stored account whole: no value is a mailed secret, and none holds one, but for a
secret's own hash, which is hex and so may hold six digits by chance.

Later tickets add the reset link, the verification link and the sign-ins.
"""
import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

from test_a_failed_mail_leaves_no_wait_armed import outbox  # noqa: F401
from test_the_organizer_sign_in_is_bounded import (  # noqa: F401
    ACCOUNT_EMAIL, CALLER, client, clock, fast_stand_in_hash,
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
