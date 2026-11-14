"""``/request-password-reset`` and ``/reset-password`` answer as they always have (ADR 0028).

The reset link is one record of ``account_secrets`` now, kept as its hash; what an organizer reads
of either route is unchanged, status and words. The waits, a failed send and the bounds are held in
``test_a_failed_mail_leaves_no_wait_armed.py`` and ``test_the_organizer_sign_in_is_bounded.py``;
the states a reset settles, in ``test_the_sign_in_secrets_hold_one_state.py``.
"""
import copy
from datetime import timedelta

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

from sign_in_secrets import live_link, stored_link
from test_a_failed_mail_leaves_no_wait_armed import outbox  # noqa: F401
from test_the_organizer_sign_in_is_bounded import (  # noqa: F401
    ACCOUNT_EMAIL, CALLER, UNVERIFIED_EMAIL, WINDOW_STARTS, client, clock, fast_stand_in_hash,
)
from test_the_sign_in_secrets_hold_one_state import users  # noqa: F401

SENT = {"msg": "If an account exists, a password reset email has been sent"}
NEW_PASSWORD = "fixture-new-password-1"
LINK = "fixture-planted-reset-link"


def _post(client, path, body):
    return client.post(path, json=body, environ_base={"REMOTE_ADDR": CALLER})


def _answer(response):
    return response.status_code, response.get_json()


def _account(users, email=ACCOUNT_EMAIL):
    return next(doc for doc in users.docs if doc["email"] == email)


class TestAskingForALink:
    def test_no_address_is_refused(self, client, users, outbox, clock):
        assert _answer(_post(client, "/request-password-reset", {})) == (
            400, {"msg": "Email required"})

    def test_an_address_with_no_account_is_answered_as_sent_and_mails_nothing(
        self, client, users, outbox, clock,
    ):
        asked = _post(client, "/request-password-reset", {"email": "fixture-nobody@example.com"})

        assert _answer(asked) == (200, SENT)
        assert outbox.sent == []

    @pytest.mark.parametrize("email", [ACCOUNT_EMAIL, UNVERIFIED_EMAIL],
                             ids=["verified", "unverified"])
    def test_an_account_is_mailed_one_link(self, client, users, outbox, clock, email):
        asked = _post(client, "/request-password-reset", {"email": email})

        assert _answer(asked) == (200, SENT)
        assert [to for to, _link in outbox.sent] == [email]


class TestResetting:
    @pytest.fixture
    def planted(self, users):
        _account(users)["secrets"] = {"reset": live_link(LINK, WINDOW_STARTS + timedelta(hours=1))}
        return users

    @pytest.mark.parametrize("body", [{}, {"token": LINK}, {"new_password": NEW_PASSWORD}],
                             ids=["neither", "no password", "no link"])
    def test_a_missing_link_or_password_is_refused(self, client, planted, clock, body):
        assert _answer(_post(client, "/reset-password", body)) == (
            400, {"msg": "Token and new password required"})

    def test_a_link_never_mailed_is_invalid(self, client, planted, clock):
        before = copy.deepcopy(planted.docs)

        reset = _post(client, "/reset-password",
                      {"token": "fixture-never-mailed", "new_password": NEW_PASSWORD})

        assert _answer(reset) == (400, {"msg": "Invalid reset token"})
        assert planted.docs == before

    def test_an_expired_link_says_so_and_changes_nothing(self, client, planted, clock):
        clock["at"] = WINDOW_STARTS + timedelta(hours=1, seconds=1)
        before = copy.deepcopy(planted.docs)

        reset = _post(client, "/reset-password", {"token": LINK, "new_password": NEW_PASSWORD})

        assert _answer(reset) == (400, {"msg": "Reset token has expired"})
        assert planted.docs == before

    def test_the_link_resets_once(self, client, planted, clock):
        first = _post(client, "/reset-password", {"token": LINK, "new_password": NEW_PASSWORD})
        again = _post(client, "/reset-password", {"token": LINK, "new_password": NEW_PASSWORD})

        assert _answer(first) == (200, {"msg": "Password reset successfully"})
        assert _answer(again) == (400, {"msg": "Invalid reset token"})
        assert stored_link(_account(planted))["state"] == "used"
