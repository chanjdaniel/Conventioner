"""A code mailed before ``account_secrets`` keeps working until it would have expired (ADR 0026).

Before it, an account held its code in three fields: ``otp`` (the code as mailed), ``otp_expires``
(an ISO string) and ``otp_attempts``. For one release the module still reads them: the first time
it reads such an account it turns them into the code's record in one conditional write, unsetting
them, and from then on the account behaves as the table says. The follow-up named in
``docs/implementation/data/users-and-email.md`` deletes this file with the upgrade.
"""
from datetime import datetime, timedelta, timezone

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import account_secrets
from account_secrets import CODE, DISCARDED, LIVE, Issued, Tried, Wait
from sign_in_secrets import live_code, stored_code
from test_the_sign_in_secrets_hold_one_state import Users

NOW = datetime(2026, 11, 13, 9, 0, 0, tzinfo=timezone.utc)
EMAIL = "fixture-organizer@example.com"
THE_CODE = "123456"
NOT_THE_CODE = "000000"
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
