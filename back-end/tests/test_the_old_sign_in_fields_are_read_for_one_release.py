"""A code or link mailed before ``account_secrets`` keeps working until it would have expired
(ADR 0026).

Before it, an account held its code in three fields: ``otp`` (the code as mailed), ``otp_expires``
(an ISO string) and ``otp_attempts``; its reset link in two: ``password_reset_token`` (the link
as mailed) and ``password_reset_token_expires``; and its verification link in two:
``verification_token`` and ``verification_token_expires``. For one release the module still reads
them: the first time it reads such an account it turns them into the records in one conditional
write, unsetting them, and from then on the account behaves as the table says. The follow-up named in
``docs/implementation/data/users-and-email.md`` deletes this file with the upgrade.
"""
from datetime import datetime, timedelta, timezone

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import account_secrets
from account_secrets import (
    CODE, DISCARDED, LIVE, RESET, SENDING, VERIFY, Issued, Link, Tried, Wait,
)
from sign_in_secrets import live_code, stored_code, stored_link, stored_verification_link
from test_the_sign_in_secrets_hold_one_state import Users

NOW = datetime(2026, 11, 13, 9, 0, 0, tzinfo=timezone.utc)
EMAIL = "fixture-organizer@example.com"
ACCOUNT_ID = "fixture-organizer-id"
THE_CODE = "123456"
NOT_THE_CODE = "000000"
THE_LINK = "fixture-legacy-reset-link"
THE_VERIFICATION_LINK = "fixture-legacy-verification-link"
PASSWORD_HASH = "fixture-new-password-hash"
LOGIN_ID = "fixture-new-login-id"
MINUTE = timedelta(minutes=1)
HOUR = timedelta(hours=1)


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    monkeypatch.setattr(account_secrets, "now", lambda: NOW)


class CountingUsers(Users):
    """The users fake, counting the writes that unset a legacy field."""

    def __init__(self, *docs):
        super().__init__(*docs)
        self.upgrades = 0

    def update_one(self, query, update, **options):
        if set(update.get("$unset", {})) & set(account_secrets.LEGACY_FIELDS):
            self.upgrades += 1
        return super().update_one(query, update, **options)


def _legacy(otp, otp_expires, otp_attempts=0):
    return CountingUsers({
        "id": "fixture-organizer-id", "email": EMAIL, "email_verified": True,
        "otp": otp, "otp_expires": otp_expires.isoformat() if otp_expires else None,
        "otp_attempts": otp_attempts,
    })


def _account(users):
    return users.docs[0]


def _no_legacy_field_left(users):
    return not set(account_secrets.LEGACY_FIELDS) & set(_account(users))


class TestALiveCode:
    """A stored ``otp`` is a live code, its tries and its wait kept."""

    @pytest.fixture
    def users(self):
        return _legacy(THE_CODE, NOW + 3 * MINUTE, otp_attempts=2)

    def test_it_signs_in_once(self, users):
        tried = account_secrets.try_code(users, EMAIL, THE_CODE)

        assert tried.outcome is Tried.RIGHT
        assert account_secrets.use_code(users, tried.account) is True
        assert account_secrets.try_code(users, EMAIL, THE_CODE).outcome is Tried.WRONG

    def test_it_is_upgraded_once_and_kept_hashed(self, users):
        account_secrets.try_code(users, EMAIL, NOT_THE_CODE)
        account_secrets.try_code(users, EMAIL, NOT_THE_CODE)

        assert users.upgrades == 1
        assert _no_legacy_field_left(users)
        code = stored_code(_account(users))
        assert account_secrets.code_matches(code["hash"], THE_CODE)
        assert code == {"hash": code["hash"], "expires_at": NOW + 3 * MINUTE,
                        "next_allowed_at": NOW + 3 * MINUTE + HOUR, "tries": 4, "state": LIVE}

    def test_its_three_remaining_tries_are_all_it_has(self, users):
        answers = [account_secrets.try_code(users, EMAIL, NOT_THE_CODE).outcome for _ in range(3)]

        assert answers == [Tried.WRONG] * 3
        assert stored_code(_account(users))["state"] == DISCARDED
        assert account_secrets.try_code(users, EMAIL, THE_CODE).outcome is Tried.WRONG

    def test_it_holds_back_the_next_code_until_an_hour_after_it_expires(self, users):
        answer = account_secrets.issue(users, CODE, dict(_account(users)))

        assert answer == Wait(seconds=63 * 60)
        assert stored_code(_account(users))["state"] == LIVE


def test_an_expired_live_code_answers_expired_with_its_wait():
    users = _legacy(THE_CODE, NOW - MINUTE)

    tried = account_secrets.try_code(users, EMAIL, THE_CODE)

    assert (tried.outcome, tried.wait) == (Tried.EXPIRED, 59 * 60)


class TestADiscardedCode:
    """A cleared ``otp`` with its expiry kept, as five wrong tries left it, is a discarded code
    keeping its wait."""

    @pytest.fixture
    def users(self):
        return _legacy(None, NOW - 10 * MINUTE)

    def test_it_holds_back_the_next_code(self, users):
        answer = account_secrets.issue(users, CODE, dict(_account(users)))

        assert answer == Wait(seconds=50 * 60)
        assert _no_legacy_field_left(users)
        code = stored_code(_account(users))
        assert (code["state"], code["next_allowed_at"]) == (DISCARDED, NOW + 50 * MINUTE)

    def test_no_try_reaches_it(self, users):
        assert account_secrets.try_code(users, EMAIL, THE_CODE).outcome is Tried.WRONG
        assert stored_code(_account(users))["state"] == DISCARDED

    def test_once_its_wait_has_passed_a_code_is_issued(self):
        users = _legacy(None, NOW - 2 * HOUR)

        assert isinstance(account_secrets.issue(users, CODE, dict(_account(users))), Issued)


class TestNoCode:
    """Cleared fields, as a used code or a new account left them, are no code."""

    @pytest.fixture
    def users(self):
        return _legacy(None, None)

    def test_they_are_unset_once_and_leave_no_record(self, users):
        assert account_secrets.try_code(users, EMAIL, THE_CODE).outcome is Tried.WRONG
        account_secrets.try_code(users, EMAIL, THE_CODE)

        assert users.upgrades == 1
        assert _no_legacy_field_left(users)
        assert stored_code(_account(users)) is None

    def test_a_code_is_issued_at_once(self, users):
        answer = account_secrets.issue(users, CODE, dict(_account(users)))

        assert isinstance(answer, Issued)
        assert _no_legacy_field_left(users)


def test_an_upgrade_another_request_made_first_is_left(monkeypatch):
    """The upgrade's write holds the legacy values it read and an absent record, so an account
    another request upgraded and issued to meanwhile keeps that request's code."""
    users = _legacy(THE_CODE, NOW + 3 * MINUTE)
    newer = live_code("246810", NOW + 5 * MINUTE)
    read = users.find_one

    def another_request_upgrades_first(query, projection=None):
        found = read(query, projection)
        account = _account(users)
        for field in account_secrets.LEGACY_FIELDS:
            account.pop(field, None)
        account["secrets"] = {"code": dict(newer)}
        return found

    monkeypatch.setattr(users, "find_one", another_request_upgrades_first)

    account_secrets.try_code(users, EMAIL, NOT_THE_CODE)

    assert stored_code(_account(users)) == {**newer, "tries": 1}


def _legacy_link(token, expires):
    return CountingUsers({
        "id": "fixture-organizer-id", "email": EMAIL, "email_verified": False,
        "password": "fixture-old-password-hash", "login_id": "fixture-old-login-id",
        "password_reset_token": token,
        "password_reset_token_expires": expires.isoformat() if expires else None,
    })


class TestALiveResetLink:
    """A stored ``password_reset_token`` is a live link, found by the token as mailed."""

    @pytest.fixture
    def users(self):
        return _legacy_link(THE_LINK, NOW + 40 * MINUTE)

    def test_it_resets_once(self, users):
        assert account_secrets.find_link(users, RESET, THE_LINK) is Link.LIVE
        assert account_secrets.use_reset_link(users, THE_LINK, PASSWORD_HASH, LOGIN_ID) == ACCOUNT_ID

        account = _account(users)
        assert (account["password"], account["login_id"], account["email_verified"]) == (
            PASSWORD_HASH, LOGIN_ID, True)
        assert account_secrets.find_link(users, RESET, THE_LINK) is Link.INVALID
        assert account_secrets.use_reset_link(users, THE_LINK, "fixture-other-hash",
                                              LOGIN_ID) is None
        assert _account(users)["password"] == PASSWORD_HASH

    def test_it_is_upgraded_once_on_the_way_and_kept_hashed(self, users):
        account_secrets.find_link(users, RESET, THE_LINK)
        account_secrets.find_link(users, RESET, THE_LINK)

        assert users.upgrades == 1
        assert _no_legacy_field_left(users)
        assert stored_link(_account(users)) == {
            "hash": account_secrets.hash_link(THE_LINK), "expires_at": NOW + 40 * MINUTE,
            "next_allowed_at": NOW + 40 * MINUTE + HOUR, "tries": 0, "state": LIVE}

    def test_it_holds_back_the_next_link_until_an_hour_after_it_expires(self, users):
        answer = account_secrets.issue(users, RESET, dict(_account(users)))

        assert answer == Wait(seconds=100 * 60)
        assert stored_link(_account(users))["state"] == LIVE

    def test_the_reset_ends_a_legacy_code_with_it(self):
        users = _legacy_link(THE_LINK, NOW + 40 * MINUTE)
        _account(users).update(otp=THE_CODE, otp_expires=(NOW + 3 * MINUTE).isoformat(),
                               otp_attempts=0, email_verified=True)

        assert account_secrets.find_link(users, RESET, THE_LINK) is Link.LIVE
        assert account_secrets.use_reset_link(users, THE_LINK, PASSWORD_HASH, LOGIN_ID) == ACCOUNT_ID

        assert stored_code(_account(users)) is None
        assert _no_legacy_field_left(users)
        assert account_secrets.try_code(users, EMAIL, THE_CODE).outcome is Tried.WRONG


def test_an_expired_legacy_link_answers_expired_and_holds_its_wait():
    users = _legacy_link(THE_LINK, NOW - 10 * MINUTE)

    assert account_secrets.find_link(users, RESET, THE_LINK) is Link.EXPIRED
    assert account_secrets.use_reset_link(users, THE_LINK, PASSWORD_HASH, LOGIN_ID) is None
    assert account_secrets.issue(users, RESET, dict(_account(users))) == Wait(seconds=50 * 60)


def test_cleared_reset_fields_are_no_link_and_a_link_is_issued_at_once():
    users = _legacy_link(None, None)

    answer = account_secrets.issue(users, RESET, dict(_account(users)))

    assert isinstance(answer, Issued)
    assert _no_legacy_field_left(users)
    assert stored_link(_account(users))["state"] == SENDING


def _legacy_verification_link(token, expires, verified=False):
    return CountingUsers({
        "id": "fixture-organizer-id", "email": EMAIL, "email_verified": verified,
        "password": "fixture-old-password-hash", "login_id": "fixture-old-login-id",
        "verification_token": token,
        "verification_token_expires": expires.isoformat() if expires else None,
    })


class TestALiveVerificationLink:
    """A stored ``verification_token`` is a live link with no wait, found by the token as
    mailed."""

    @pytest.fixture
    def users(self):
        return _legacy_verification_link(THE_VERIFICATION_LINK, NOW + 40 * MINUTE)

    def test_it_verifies_once(self, users):
        assert account_secrets.find_link(users, VERIFY, THE_VERIFICATION_LINK) is Link.LIVE
        assert account_secrets.use_verification_link(users, THE_VERIFICATION_LINK) is False

        assert _account(users)["email_verified"] is True
        assert account_secrets.find_link(users, VERIFY, THE_VERIFICATION_LINK) is Link.INVALID
        assert account_secrets.use_verification_link(users, THE_VERIFICATION_LINK) is None

    def test_it_is_upgraded_once_on_the_way_and_kept_hashed(self, users):
        account_secrets.find_link(users, VERIFY, THE_VERIFICATION_LINK)
        account_secrets.find_link(users, VERIFY, THE_VERIFICATION_LINK)

        assert users.upgrades == 1
        assert _no_legacy_field_left(users)
        assert stored_verification_link(_account(users)) == {
            "hash": account_secrets.hash_link(THE_VERIFICATION_LINK),
            "expires_at": NOW + 40 * MINUTE, "next_allowed_at": None, "tries": 0, "state": LIVE}

    def test_a_new_link_may_be_asked_for_at_once_and_replaces_it(self, users):
        answer = account_secrets.issue(users, VERIFY, dict(_account(users)))

        assert isinstance(answer, Issued)
        assert _no_legacy_field_left(users)
        assert account_secrets.find_link(users, VERIFY, THE_VERIFICATION_LINK) is Link.INVALID

    def test_a_reset_ends_it(self, users):
        _account(users).update(password_reset_token=THE_LINK,
                               password_reset_token_expires=(NOW + 40 * MINUTE).isoformat())

        assert account_secrets.find_link(users, RESET, THE_LINK) is Link.LIVE
        assert account_secrets.use_reset_link(users, THE_LINK, PASSWORD_HASH, LOGIN_ID) == ACCOUNT_ID

        assert stored_verification_link(_account(users)) is None
        assert _no_legacy_field_left(users)
        assert account_secrets.find_link(users, VERIFY, THE_VERIFICATION_LINK) is Link.INVALID


def test_an_expired_legacy_verification_link_answers_expired_and_verifies_nothing():
    users = _legacy_verification_link(THE_VERIFICATION_LINK, NOW - 10 * MINUTE)

    assert account_secrets.find_link(users, VERIFY, THE_VERIFICATION_LINK) is Link.EXPIRED
    assert account_secrets.use_verification_link(users, THE_VERIFICATION_LINK) is None
    assert _account(users)["email_verified"] is False


@pytest.mark.parametrize("token, expires", [(None, None), (THE_VERIFICATION_LINK, None)],
                         ids=["cleared", "no expiry"])
def test_verification_fields_holding_no_live_link_are_no_link(token, expires):
    """Cleared fields, as a verified account or one made by hand held them, are no link; so is a
    token with no expiry, which the old route answered as expired. Either is unset once."""
    users = _legacy_verification_link(token, expires)

    assert account_secrets.find_link(users, VERIFY, THE_VERIFICATION_LINK) is Link.INVALID
    answer = account_secrets.issue(users, VERIFY, dict(_account(users)))

    assert isinstance(answer, Issued)
    assert _no_legacy_field_left(users)
    assert stored_verification_link(_account(users))["state"] == SENDING


def test_a_verified_accounts_cleared_fields_are_unset_with_no_link():
    users = _legacy_verification_link(None, None, verified=True)

    assert account_secrets.issue(users, CODE, dict(_account(users))) is not None

    assert _no_legacy_field_left(users)
    assert stored_verification_link(_account(users)) is None
