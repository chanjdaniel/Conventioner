"""``/register``, ``/resend-verification`` and ``/verify-email`` answer as they always have
(ADR 0027).

The verification link is one record of ``account_secrets`` now, kept as its hash; what an organizer
reads of each route is unchanged, status and words, but for two answers to cases the record made
new: a resend while another request's link is being mailed mails none and answers as sent, since
one link is on its way, and a link used meanwhile is answered as one that is not there. The bounds
are held in ``test_the_organizer_sign_in_is_bounded.py``; a refused mail, in
``test_a_failed_mail_leaves_no_wait_armed.py``; a taken address, in
``test_one_account_per_address.py``.
"""
import copy
from datetime import timedelta

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import account_secrets
import api.users as UsersApi
from sign_in_secrets import live_verification_link, stored_verification_link
from test_a_failed_mail_leaves_no_wait_armed import outbox  # noqa: F401
from test_the_organizer_sign_in_is_bounded import (  # noqa: F401
    ACCOUNT_EMAIL, CALLER, UNVERIFIED_EMAIL, WINDOW_STARTS, client, clock, fast_stand_in_hash,
)
from test_the_sign_in_secrets_hold_one_state import users  # noqa: F401

NEW_EMAIL = "fixture-new-organizer@example.com"
PASSWORD = "fixture-password-1"
LINK = "fixture-planted-verification-link"

SIGNED_UP = (201, {
    "msg": "User registered successfully. Please check your email to verify your account."})
SEND_FAILED = (500, {
    "msg": "Registration failed: Unable to send verification email. Please check your email "
           "configuration or contact support.",
    "error": "email_send_failed"})
SENT = (200, {"msg": "Verification email sent"})
NO_ACCOUNT = (200, {"msg": "If an account exists, a verification email has been sent"})
ALREADY_VERIFIED = (400, {"msg": "Email already verified"})
INVALID = (400, {"msg": "Invalid verification token"})


def _post(client, path, body):
    return client.post(path, json=body, environ_base={"REMOTE_ADDR": CALLER})


def _answer(response):
    return response.status_code, response.get_json()


def _account(users, email):
    return next((doc for doc in users.docs if doc["email"] == email), None)


@pytest.fixture
def captcha(monkeypatch):
    passing = {"yes": True}
    monkeypatch.setattr(UsersApi, "verify_recaptcha", lambda *_a: (passing["yes"], 0.9))
    return passing


def _register(client, **body):
    return _post(client, "/register", {"email": NEW_EMAIL, "password": PASSWORD,
                                       "captcha_token": "fixture-captcha", **body})


class TestSigningUp:
    @pytest.mark.parametrize("body, answer", [
        ({"email": ""}, (400, {"msg": "Email and password required"})),
        ({"password": ""}, (400, {"msg": "Email and password required"})),
        ({"captcha_token": ""}, (400, {"msg": "CAPTCHA verification required"})),
        ({"email": "fixture-no-domain"}, (400, {"msg": "Invalid email format"})),
        ({"password": "short"}, (400, {"msg": "Password must be at least 8 characters long"})),
        ({"password": "x" * 73}, (400, {"msg": UsersApi.PASSWORD_TOO_LONG})),
    ], ids=["no address", "no password", "no captcha", "no domain", "short", "too long"])
    def test_a_refused_sign_up_stores_nothing_and_mails_nothing(
        self, client, users, outbox, clock, captcha, body, answer,
    ):
        before = copy.deepcopy(users.docs)

        assert _answer(_register(client, **body)) == answer
        assert users.docs == before
        assert outbox.sent == []

    def test_a_failed_captcha_is_refused(self, client, users, outbox, clock, captcha):
        captcha["yes"] = False

        assert _answer(_register(client)) == (400, {"msg": "CAPTCHA verification failed"})
        assert _account(users, NEW_EMAIL) is None

    def test_a_new_address_is_mailed_a_link_that_verifies_it(
        self, client, users, outbox, clock, captcha,
    ):
        assert _answer(_register(client)) == SIGNED_UP

        [(to, link)] = outbox.sent
        assert to == NEW_EMAIL
        account = _account(users, NEW_EMAIL)
        assert account["email_verified"] is False
        assert stored_verification_link(account) == {
            "hash": account_secrets.hash_link(link),
            "expires_at": WINDOW_STARTS + timedelta(hours=1), "next_allowed_at": WINDOW_STARTS,
            "tries": 0, "state": account_secrets.LIVE}
        assert not set(account_secrets.LEGACY_FIELDS) & set(account)

        assert _answer(_post(client, "/verify-email", {"token": link})) == (
            200, {"msg": "Email verified successfully"})
        assert _account(users, NEW_EMAIL)["email_verified"] is True

    def test_a_failed_send_leaves_no_account(self, client, users, outbox, clock, captcha):
        outbox.failing = True

        assert _answer(_register(client)) == SEND_FAILED
        assert _account(users, NEW_EMAIL) is None


class TestAskingForTheLinkAgain:
    def _resend(self, client, email=UNVERIFIED_EMAIL):
        return _post(client, "/resend-verification", {"email": email})

    def test_no_address_is_refused(self, client, users, outbox, clock):
        assert _answer(_post(client, "/resend-verification", {})) == (
            400, {"msg": "Email required"})

    def test_an_address_with_no_account_is_answered_and_mails_nothing(
        self, client, users, outbox, clock,
    ):
        assert _answer(self._resend(client, "fixture-nobody@example.com")) == NO_ACCOUNT
        assert outbox.sent == []

    def test_a_verified_address_is_told_so_and_mailed_nothing(self, client, users, outbox, clock):
        assert _answer(self._resend(client, ACCOUNT_EMAIL)) == ALREADY_VERIFIED
        assert outbox.sent == []
        assert stored_verification_link(_account(users, ACCOUNT_EMAIL)) is None

    def test_a_new_link_replaces_the_last_at_once(self, client, users, outbox, clock):
        _account(users, UNVERIFIED_EMAIL)["secrets"] = {
            "verify": live_verification_link(LINK, WINDOW_STARTS + timedelta(minutes=50))}

        assert _answer(self._resend(client)) == SENT
        assert _answer(self._resend(client)) == SENT

        [(_to, first), (_to2, second)] = outbox.sent
        assert stored_verification_link(_account(users, UNVERIFIED_EMAIL))["hash"] == (
            account_secrets.hash_link(second))
        for replaced in (LINK, first):
            assert _answer(_post(client, "/verify-email", {"token": replaced})) == INVALID
        assert _answer(_post(client, "/verify-email", {"token": second}))[0] == 200

    def test_while_another_link_is_being_mailed_it_mails_none_and_answers_sent(
        self, client, users, outbox, clock,
    ):
        sending = live_verification_link(LINK, WINDOW_STARTS + timedelta(minutes=59))
        sending.update(state=account_secrets.SENDING, next_allowed_at=None)
        _account(users, UNVERIFIED_EMAIL)["secrets"] = {"verify": sending}

        assert _answer(self._resend(client)) == SENT
        assert outbox.sent == []
        assert stored_verification_link(_account(users, UNVERIFIED_EMAIL)) == sending

    def test_a_failed_send_says_so(self, client, users, outbox, clock):
        outbox.failing = True

        assert _answer(self._resend(client)) == (
            500, {"msg": "Failed to send verification email"})


class TestFollowingTheLink:
    @pytest.fixture
    def planted(self, users):
        _account(users, UNVERIFIED_EMAIL)["secrets"] = {
            "verify": live_verification_link(LINK, WINDOW_STARTS + timedelta(minutes=30))}
        return users

    def test_no_link_is_refused(self, client, planted, clock):
        assert _answer(_post(client, "/verify-email", {})) == (
            400, {"msg": "Verification token required"})

    def test_a_link_never_mailed_is_invalid(self, client, planted, clock):
        before = copy.deepcopy(planted.docs)

        assert _answer(_post(client, "/verify-email", {"token": "fixture-never-mailed"})) == (
            INVALID)
        assert planted.docs == before

    def test_an_expired_link_says_so_and_changes_nothing(self, client, planted, clock):
        clock["at"] = WINDOW_STARTS + timedelta(minutes=30, seconds=1)
        before = copy.deepcopy(planted.docs)

        assert _answer(_post(client, "/verify-email", {"token": LINK})) == (
            400, {"msg": "Verification token has expired"})
        assert planted.docs == before

    def test_the_link_verifies_once(self, client, planted, clock):
        first = _post(client, "/verify-email", {"token": LINK})
        again = _post(client, "/verify-email", {"token": LINK})

        assert _answer(first) == (200, {"msg": "Email verified successfully"})
        assert _answer(again) == INVALID
        account = _account(planted, UNVERIFIED_EMAIL)
        assert account["email_verified"] is True
        assert stored_verification_link(account)["state"] == account_secrets.USED

    def test_a_live_link_on_an_address_already_verified_says_so(self, client, planted, clock):
        _account(planted, UNVERIFIED_EMAIL)["email_verified"] = True

        assert _answer(_post(client, "/verify-email", {"token": LINK})) == ALREADY_VERIFIED
