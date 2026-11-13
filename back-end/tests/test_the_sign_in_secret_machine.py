"""An account's sign-in secrets move between their states only as the table says (ADR 0026).

Each test is one column of the table in ``account_secrets`` (an event) over every row (a state the
kind's record can be in), driven through the module's functions on a users collection read and
written by the suite's shared matcher and update, and reads what the database then holds and what
the module answered. The rows a time splits (a wait ahead or passed) are each a row of their own.

The "expires" column is the clock passing a record's ``expires_at``, which writes nothing: each of
its cells is the move from an unexpired row to its expired row ("treated as none" for a code being
mailed, "treated as expired" for a live one), whose cells the other columns check.

Later kinds add their rows here: the reset link and the verification link.
"""
import copy
from datetime import datetime, timedelta, timezone

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import account_secrets
from account_secrets import CODE, DISCARDED, LIVE, SENDING, USED, Issued, Tried, Wait
from test_the_sign_in_secrets_hold_one_state import Users

NOW = datetime(2026, 11, 13, 9, 0, 0, tzinfo=timezone.utc)
EMAIL = "fixture-organizer@example.com"
ACCOUNT_ID = "fixture-organizer-id"
THE_CODE = "123456"
NOT_THE_CODE = "000000"
MINUTE = timedelta(minutes=1)
HOUR = timedelta(hours=1)


def _record(state, expires_at, next_allowed_at, tries=0):
    return {"hash": account_secrets.hash_code(THE_CODE), "expires_at": expires_at,
            "next_allowed_at": next_allowed_at, "tries": tries, "state": state}


#: Every state the code's record can be in, by name; None is no record.
ROWS = {
    "none": None,
    "sending, unexpired": _record(SENDING, NOW + 3 * MINUTE, None),
    "sending, expired": _record(SENDING, NOW - MINUTE, None),
    "live, unexpired": _record(LIVE, NOW + 3 * MINUTE, NOW + 3 * MINUTE + HOUR),
    "live, expired, wait ahead": _record(LIVE, NOW - MINUTE, NOW + 59 * MINUTE),
    "live, expired, wait passed": _record(LIVE, NOW - 2 * HOUR, NOW - HOUR),
    "used": _record(USED, NOW - MINUTE, None),
    "discarded, wait ahead": _record(DISCARDED, NOW - MINUTE, NOW + 59 * MINUTE, tries=5),
    "discarded, wait passed": _record(DISCARDED, NOW - 2 * HOUR, NOW - HOUR, tries=5),
}


@pytest.fixture
def clock(monkeypatch):
    now = {"at": NOW}
    monkeypatch.setattr(account_secrets, "now", lambda: now["at"])
    return now


def _users(row):
    account = {"id": ACCOUNT_ID, "email": EMAIL, "email_verified": True}
    if ROWS[row] is not None:
        account["secrets"] = {"code": copy.deepcopy(ROWS[row])}
    return Users(account)


def _code(users):
    return (users.docs[0].get("secrets") or {}).get("code")


# issue: sending where no wait is ahead and no unexpired code is being mailed, else the wait.

ISSUE = {
    "none": "issued",
    "sending, unexpired": ("wait", 3 * 60 + 3600),
    "sending, expired": "issued",
    "live, unexpired": ("wait", 3 * 60 + 3600),
    "live, expired, wait ahead": ("wait", 59 * 60),
    "live, expired, wait passed": "issued",
    "used": "issued",
    "discarded, wait ahead": ("wait", 59 * 60),
    "discarded, wait passed": "issued",
}


@pytest.mark.parametrize("row", list(ROWS), ids=list(ROWS))
def test_issue(clock, row):
    users = _users(row)
    before = copy.deepcopy(_code(users))

    answer = account_secrets.issue(users, CODE, users.docs[0])

    if ISSUE[row] == "issued":
        assert isinstance(answer, Issued)
        assert account_secrets.code_matches(_code(users)["hash"], answer.secret)
        assert _code(users) == {"hash": answer.hash, "expires_at": NOW + 5 * MINUTE,
                                "next_allowed_at": None, "tries": 0, "state": SENDING}
    else:
        assert answer == Wait(seconds=ISSUE[row][1])
        assert _code(users) == before


def test_issue_needs_a_verified_account(clock):
    users = _users("none")
    users.docs[0]["email_verified"] = False

    assert account_secrets.issue(users, CODE, users.docs[0]) is None
    assert _code(users) is None


# provider accepted, provider refused: only the issued code, while it is being mailed.

def _issued_now(users):
    return account_secrets.issue(users, CODE, users.docs[0])


def test_accepted_makes_the_code_live_with_its_wait(clock):
    users = _users("none")
    issued = _issued_now(users)

    account_secrets.accepted(users, CODE, issued)

    assert _code(users) == {"hash": issued.hash, "expires_at": NOW + 5 * MINUTE,
                            "next_allowed_at": NOW + 5 * MINUTE + HOUR, "tries": 0, "state": LIVE}


def test_refused_unsets_the_code(clock):
    users = _users("none")
    issued = _issued_now(users)

    account_secrets.refused(users, CODE, issued)

    assert _code(users) is None


@pytest.mark.parametrize("answer", ["accepted", "refused"])
def test_a_provider_answer_past_the_codes_life_writes_nothing(clock, answer):
    users = _users("none")
    issued = _issued_now(users)
    clock["at"] = NOW + 6 * MINUTE
    before = copy.deepcopy(_code(users))

    getattr(account_secrets, answer)(users, CODE, issued)

    assert _code(users) == before


OTHER_ROWS = [row for row in ROWS if not row.startswith("sending")]


@pytest.mark.parametrize("answer", ["accepted", "refused"])
@pytest.mark.parametrize("row", OTHER_ROWS, ids=OTHER_ROWS)
def test_a_provider_answer_for_a_code_no_longer_held_writes_nothing(clock, row, answer):
    users = _users(row)
    before = copy.deepcopy(users.docs)
    elsewhere = Issued(account_id=ACCOUNT_ID, secret=THE_CODE,
                       hash=account_secrets.hash_code(THE_CODE), expires_at=NOW + 5 * MINUTE)

    getattr(account_secrets, answer)(users, CODE, elsewhere)

    assert users.docs == before


# right try, wrong try.

RIGHT_TRY = {
    "none": Tried.WRONG,
    "sending, unexpired": Tried.WRONG,
    "sending, expired": Tried.WRONG,
    "live, unexpired": Tried.RIGHT,
    "live, expired, wait ahead": (Tried.EXPIRED, 59 * 60),
    "live, expired, wait passed": (Tried.EXPIRED, None),
    "used": Tried.WRONG,
    "discarded, wait ahead": Tried.WRONG,
    "discarded, wait passed": Tried.WRONG,
}


def _counted(record):
    return {**record, "tries": record["tries"] + 1}


@pytest.mark.parametrize("row", list(ROWS), ids=list(ROWS))
def test_right_try(clock, row):
    users = _users(row)
    before = copy.deepcopy(_code(users))

    tried = account_secrets.try_code(users, EMAIL, THE_CODE)

    expected = RIGHT_TRY[row]
    if expected is Tried.WRONG:
        assert tried.outcome is Tried.WRONG
        assert _code(users) == before
    elif expected is Tried.RIGHT:
        assert tried.outcome is Tried.RIGHT
        assert _code(users) == _counted(before)
        assert account_secrets.use_code(users, tried.account) is True
        assert _code(users) == {**_counted(before), "state": USED, "next_allowed_at": None}
    else:
        assert (tried.outcome, tried.wait) == expected
        assert _code(users) == _counted(before)


def test_of_two_right_tries_one_uses_the_code(clock):
    users = _users("live, unexpired")
    first = account_secrets.try_code(users, EMAIL, THE_CODE)
    second = account_secrets.try_code(users, EMAIL, THE_CODE)

    assert [account_secrets.use_code(users, tried.account) for tried in (first, second)] == [
        True, False]


@pytest.mark.parametrize("row", list(ROWS), ids=list(ROWS))
def test_wrong_try(clock, row):
    users = _users(row)
    before = copy.deepcopy(_code(users))

    tried = account_secrets.try_code(users, EMAIL, NOT_THE_CODE)

    assert tried.outcome is Tried.WRONG
    if before is not None and before["state"] == LIVE:
        assert _code(users) == _counted(before)
    else:
        assert _code(users) == before


@pytest.mark.parametrize("row", ["live, unexpired", "live, expired, wait ahead"])
def test_the_fifth_wrong_try_discards_the_code_and_keeps_its_wait(clock, row):
    users = _users(row)
    before = copy.deepcopy(_code(users))

    answers = [account_secrets.try_code(users, EMAIL, NOT_THE_CODE).outcome for _ in range(6)]

    assert answers == [Tried.WRONG] * 6
    assert _code(users) == {**before, "tries": 5, "state": DISCARDED}
    assert account_secrets.try_code(users, EMAIL, THE_CODE).outcome is Tried.WRONG
