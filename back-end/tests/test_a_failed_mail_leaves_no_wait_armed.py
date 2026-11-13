"""A code or link that could not be mailed leaves the organizer free to ask again (T273, R14).

The organizer's code, reset link and verification link are stored before they are mailed, since
the mail names them. When the send failed, the next request works at once. A code or reset link
the provider refused is unset (``account_secrets.refused``), so it leaves no wait and no live
secret, and no earlier one is written back. For a verification link, the route puts back what it
replaced, so a link already in the inbox keeps working. A newer code or link another request stored
meanwhile is left. The counts per caller and per address are not taken back: they count requests,
whether or not a mail went.

Reproduced on dev through the routes, the send made to fail: a code request answered 500 and the
next 429 for about an hour, a reset request 500 and then 429, and a failed verification resend left
the first link refused.
"""
from datetime import timedelta

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import account_secrets
import app as app_module
import api.users as UsersApi
import sign_in_limits
from sign_in_secrets import live_code, live_link, stored_code, stored_link
from test_the_organizer_sign_in_is_bounded import (  # noqa: F401
    ACCOUNT_EMAIL, CALLER, FAST_ROUNDS, PASSWORD, UNVERIFIED_EMAIL, WINDOW_STARTS, Users, _account,
    client, clock, fast_stand_in_hash,
)

NEW_PASSWORD = "fixture-new-password-1"
FIRST_LINK = "fixture-first-verification-link"
NEWER = "fixture-newer-code-or-link"

SENT_CODE = "If an account exists for that address, a sign-in code has been sent to it."
SENT_RESET = "If an account exists, a password reset email has been sent"
SENT_VERIFICATION = "Verification email sent"
ASKED_TOO_OFTEN = "You have asked several times. Try again in 15 minutes."


@pytest.fixture
def users(monkeypatch):
    unverified = _account(UNVERIFIED_EMAIL, verified=False)
    unverified["verification_token"] = FIRST_LINK
    unverified["verification_token_expires"] = (WINDOW_STARTS + timedelta(days=400)).isoformat()
    fake = Users(_account(ACCOUNT_EMAIL), unverified)
    monkeypatch.setattr(UsersApi, "users_collection", fake)
    # A reset hashes its new password at bcrypt's lowest cost, as the accounts here are hashed.
    monkeypatch.setattr(app_module.bcrypt, "_log_rounds", FAST_ROUNDS)
    return fake


class Mail:
    """One of the three mails, its route, the fields it stores and the secret its mail names."""

    def __init__(self, path, sender, sends_to, fields, sent, per_address):
        self.path = path
        self.sender = sender
        self.sends_to = sends_to
        self.fields = fields
        self.sent = sent
        self.per_address = per_address

    def __repr__(self):
        return self.path

    def ask(self, client, caller=CALLER):
        return client.post(self.path, json={"email": self.sends_to},
                           environ_base={"REMOTE_ADDR": caller})


CODE = Mail("/request-otp", "send_otp_email", ACCOUNT_EMAIL, (), SENT_CODE,
            sign_in_limits.ORGANIZER_CODE_REQUEST_PER_ADDRESS)
RESET = Mail("/request-password-reset", "send_password_reset_email", ACCOUNT_EMAIL, (),
             SENT_RESET, sign_in_limits.RESET_LINK_PER_ADDRESS)
VERIFICATION = Mail("/resend-verification", "send_verification_email", UNVERIFIED_EMAIL,
                    ("verification_token", "verification_token_expires"),
                    SENT_VERIFICATION, sign_in_limits.VERIFICATION_LINK_PER_ADDRESS)
MAILS = [CODE, RESET, VERIFICATION]
#: The mails whose failed send puts back the link the account held.
PUT_BACK = [VERIFICATION]


class Outbox:
    """The three mails' sends, which fail while ``failing`` and record each secret they were given.

    ``meanwhile`` runs inside a send before it answers, standing for another request that stored a
    newer code or link between this request's write and its failed send.
    """

    def __init__(self):
        self.failing = False
        self.meanwhile = None
        self.sent = []

    def sender(self, to, secret):
        if self.meanwhile:
            self.meanwhile(to)
        if self.failing:
            return False
        self.sent.append((to, secret))
        return True

    def last(self):
        return self.sent[-1][1]


@pytest.fixture
def outbox(monkeypatch):
    box = Outbox()
    for mail in MAILS:
        monkeypatch.setattr(UsersApi, mail.sender, box.sender)
    return box


FAILED_SEND = {
    "/request-otp": "The sign-in code could not be sent. Please try again.",
    "/request-password-reset": "Failed to send password reset email",
    "/resend-verification": "Failed to send verification email",
}


def _fail_once(client, outbox, mail):
    """One request whose send fails, answered as a failed send always has been."""
    outbox.failing = True
    failed = mail.ask(client)
    outbox.failing = False
    assert (failed.status_code, failed.get_json()) == (500, {"msg": FAILED_SEND[mail.path]})


class TestAfterAFailedSendTheNextRequestWorks:
    def test_the_next_code_request_sends_a_code_that_signs_in(self, client, users, outbox, clock):
        _fail_once(client, outbox, CODE)

        asked = CODE.ask(client)
        assert (asked.status_code, asked.get_json()) == (200, {"msg": SENT_CODE})

        signed_in = client.post("/login-otp", json={"email": ACCOUNT_EMAIL, "otp": outbox.last()},
                                environ_base={"REMOTE_ADDR": CALLER})
        assert signed_in.status_code == 200

    def test_the_next_reset_request_sends_a_link_that_resets(self, client, users, outbox, clock):
        _fail_once(client, outbox, RESET)

        asked = RESET.ask(client)
        assert (asked.status_code, asked.get_json()) == (200, {"msg": SENT_RESET})

        reset = client.post("/reset-password",
                            json={"token": outbox.last(), "new_password": NEW_PASSWORD})
        assert reset.status_code == 200
        signed_in = client.post("/login", json={"email": ACCOUNT_EMAIL, "password": NEW_PASSWORD},
                                environ_base={"REMOTE_ADDR": CALLER})
        assert signed_in.status_code == 200

    def test_the_link_mailed_before_a_failed_resend_still_verifies(
        self, client, users, outbox, clock,
    ):
        _fail_once(client, outbox, VERIFICATION)

        verified = client.post("/verify-email", json={"token": FIRST_LINK})

        assert verified.status_code == 200
        assert users.account(UNVERIFIED_EMAIL)["email_verified"] is True

    def test_the_next_verification_resend_sends_a_link_that_verifies(
        self, client, users, outbox, clock,
    ):
        _fail_once(client, outbox, VERIFICATION)

        assert VERIFICATION.ask(client).status_code == 200
        assert client.post("/verify-email", json={"token": outbox.last()}).status_code == 200

    @pytest.mark.parametrize("mail", PUT_BACK, ids=repr)
    def test_the_account_holds_what_it_held_before(self, client, users, outbox, clock, mail):
        account = users.account(mail.sends_to)
        before = {field: account.get(field) for field in mail.fields}

        _fail_once(client, outbox, mail)

        assert {field: account.get(field) for field in mail.fields} == before


@pytest.mark.parametrize("mail", PUT_BACK, ids=repr)
def test_a_newer_value_stored_during_the_failed_send_is_left(client, users, outbox, clock, mail):
    later = (WINDOW_STARTS + timedelta(days=400)).isoformat()
    newer = {field: 0 if field == "otp_attempts" else later if field.endswith("_expires")
             else NEWER for field in mail.fields}

    def another_request_stores_a_newer_one(to):
        users.update_one({"email": to}, {"$set": newer})

    outbox.meanwhile = another_request_stores_a_newer_one
    _fail_once(client, outbox, mail)

    account = users.account(mail.sends_to)
    assert {field: account.get(field) for field in mail.fields} == newer


class TestARefusedCodeLeavesNoCode:
    """The code is one record (``account_secrets``): a refused mail unsets it."""

    def test_it_leaves_no_code_and_no_wait(self, client, users, outbox, clock):
        _fail_once(client, outbox, CODE)

        account = users.account(ACCOUNT_EMAIL)
        assert stored_code(account) is None
        assert not set(account_secrets.LEGACY_FIELDS) & set(account)

    @pytest.mark.parametrize("earlier", [account_secrets.USED, account_secrets.DISCARDED])
    def test_no_earlier_code_is_written_back(self, client, users, outbox, clock, earlier):
        # A code mailed two hours before, since used or discarded: its wait has passed.
        code = live_code("135791", WINDOW_STARTS - timedelta(hours=2))
        code.update(state=earlier, next_allowed_at=None if earlier == account_secrets.USED
                    else code["next_allowed_at"])
        users.account(ACCOUNT_EMAIL)["secrets"] = {"code": code}

        _fail_once(client, outbox, CODE)

        assert stored_code(users.account(ACCOUNT_EMAIL)) is None

    def test_a_newer_code_issued_during_the_failed_send_is_left(
        self, client, users, outbox, clock,
    ):
        newer = live_code("246810", WINDOW_STARTS + timedelta(minutes=5))

        def another_request_mails_a_newer_one(to):
            users.account(to)["secrets"] = {"code": dict(newer)}

        outbox.meanwhile = another_request_mails_a_newer_one
        _fail_once(client, outbox, CODE)

        assert stored_code(users.account(ACCOUNT_EMAIL)) == newer


class TestARefusedResetLinkLeavesNoLink:
    """The reset link is one record (``account_secrets``): a refused mail unsets it."""

    def test_it_leaves_no_link_and_no_wait(self, client, users, outbox, clock):
        _fail_once(client, outbox, RESET)

        account = users.account(ACCOUNT_EMAIL)
        assert stored_link(account) is None
        assert not set(account_secrets.LEGACY_FIELDS) & set(account)

    def test_the_next_request_mails_a_link_at_once(self, client, users, outbox, clock):
        _fail_once(client, outbox, RESET)

        asked = RESET.ask(client)

        assert (asked.status_code, asked.get_json()) == (200, {"msg": SENT_RESET})
        assert len(outbox.sent) == 1
        assert stored_link(users.account(ACCOUNT_EMAIL))["hash"] == account_secrets.hash_link(
            outbox.last())

    def test_no_earlier_link_is_written_back(self, client, users, outbox, clock):
        # A link mailed three hours before and used: its wait is cleared.
        used = live_link("fixture-earlier-link", WINDOW_STARTS - timedelta(hours=2))
        used.update(state=account_secrets.USED, next_allowed_at=None)
        users.account(ACCOUNT_EMAIL)["secrets"] = {"reset": used}

        _fail_once(client, outbox, RESET)

        assert stored_link(users.account(ACCOUNT_EMAIL)) is None

    def test_a_newer_link_issued_during_the_failed_send_is_left(
        self, client, users, outbox, clock,
    ):
        newer = live_link("fixture-newer-link", WINDOW_STARTS + timedelta(hours=1))

        def another_request_mails_a_newer_one(to):
            users.account(to)["secrets"] = {"reset": dict(newer)}

        outbox.meanwhile = another_request_mails_a_newer_one
        _fail_once(client, outbox, RESET)

        assert stored_link(users.account(ACCOUNT_EMAIL)) == newer


@pytest.mark.parametrize("mail", MAILS, ids=repr)
def test_a_failed_send_keeps_its_count_so_the_sixth_request_waits(
    client, users, outbox, clock, mail,
):
    for _ in range(mail.per_address.attempts):
        _fail_once(client, outbox, mail)
    outbox.failing = True
    sixth = mail.ask(client)

    assert (sixth.status_code, sixth.get_json()) == (429, {"msg": ASKED_TOO_OFTEN})


class TestTheResetLinksWaitSaysHowLong:
    """One reset link at a time, until an hour after the last one expired."""

    def _last_link_expired(self, users, ago):
        users.account(ACCOUNT_EMAIL)["secrets"] = {
            "reset": live_link("fixture-earlier-link", WINDOW_STARTS - ago)}

    def test_asking_too_soon_says_the_minutes_left(self, client, users, outbox, clock):
        self._last_link_expired(users, timedelta(minutes=30))

        asked = RESET.ask(client)

        assert (asked.status_code, asked.get_json()) == (
            429, {"msg": "You can ask for another reset link in 30 minutes."})
        assert outbox.sent == []

    def test_the_last_seconds_read_as_one_minute(self, client, users, outbox, clock):
        self._last_link_expired(users, timedelta(minutes=59, seconds=30))

        asked = RESET.ask(client)

        assert (asked.status_code, asked.get_json()) == (
            429, {"msg": "You can ask for another reset link in 1 minute."})

    def test_an_hour_after_the_last_link_expired_a_new_one_is_sent(
        self, client, users, outbox, clock,
    ):
        self._last_link_expired(users, timedelta(hours=1))

        assert RESET.ask(client).status_code == 200
        assert len(outbox.sent) == 1
