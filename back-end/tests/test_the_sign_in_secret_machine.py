"""An account's sign-in secrets move between their states only as the table says (ADR 0026).

Each test is one column of the table in ``account_secrets`` (an event) over every row (a state the
kind's record can be in), driven through the module's functions on a users collection read and
written by the suite's shared matcher and update, and reads what the database then holds and what
the module answered. The rows a time splits (a wait ahead or passed) are each a row of their own.

The "expires" column is the clock passing a record's ``expires_at``, which writes nothing: each of
its cells is the move from an unexpired row to its expired row ("treated as none" for a secret
being mailed, "treated as expired" for a live one), whose cells the other columns check.

The "password reset" column is a reset by a live reset link, over every row of the code and of the
verification link; for the reset link itself it is the "link used" column. Tries are not counted on
a link, so it has no "wrong try" column: a link that is not the one stored is found by no hash.

The verification link has no wait: once mailed, its ``next_allowed_at`` is the moment it was mailed,
so a new link may be asked for at once, while the last is live. Its rows have no wait ahead but a
discarded one, which no event reaches but which the table still answers.
"""
import copy
from datetime import datetime, timedelta, timezone

import pytest

from conftest import skip_without_real_dependencies

skip_without_real_dependencies()

import account_secrets
from account_secrets import (
    CODE, DISCARDED, LIVE, RESET, SENDING, USED, VERIFY, Issued, Link, Tried, Wait,
)
from test_the_sign_in_secrets_hold_one_state import Users

NOW = datetime(2026, 11, 13, 9, 0, 0, tzinfo=timezone.utc)
EMAIL = "fixture-organizer@example.com"
ACCOUNT_ID = "fixture-organizer-id"
THE_CODE = "123456"
NOT_THE_CODE = "000000"
THE_LINK = "fixture-reset-link"
NOT_THE_LINK = "fixture-another-link"
PASSWORD_HASH = "fixture-new-password-hash"
LOGIN_ID = "fixture-new-login-id"
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


# password reset, over the code: a reset by a live link ends the code, whatever state it is in.

def _with_a_live_link(users):
    users.docs[0].setdefault("secrets", {})["reset"] = _link_record(
        LIVE, NOW + 30 * MINUTE, NOW + 30 * MINUTE + HOUR)
    return users


@pytest.mark.parametrize("row", list(ROWS), ids=list(ROWS))
def test_a_password_reset_ends_the_code(clock, row):
    users = _with_a_live_link(_users(row))

    assert account_secrets.use_reset_link(users, THE_LINK, PASSWORD_HASH, LOGIN_ID) == ACCOUNT_ID

    assert _code(users) is None


# The reset link's rows.

def _link_record(state, expires_at, next_allowed_at):
    return {"hash": account_secrets.hash_link(THE_LINK), "expires_at": expires_at,
            "next_allowed_at": next_allowed_at, "tries": 0, "state": state}


#: Every state the reset link's record can be in, by name; None is no record. A discarded link is
#: what the fields of one release held for a link cleared with its wait kept.
LINK_ROWS = {
    "none": None,
    "sending, unexpired": _link_record(SENDING, NOW + 30 * MINUTE, None),
    "sending, expired": _link_record(SENDING, NOW - MINUTE, None),
    "live, unexpired": _link_record(LIVE, NOW + 30 * MINUTE, NOW + 30 * MINUTE + HOUR),
    "live, expired, wait ahead": _link_record(LIVE, NOW - MINUTE, NOW + 59 * MINUTE),
    "live, expired, wait passed": _link_record(LIVE, NOW - 2 * HOUR, NOW - HOUR),
    "used": _link_record(USED, NOW - MINUTE, None),
    "discarded, wait ahead": _link_record(DISCARDED, NOW - MINUTE, NOW + 59 * MINUTE),
    "discarded, wait passed": _link_record(DISCARDED, NOW - 2 * HOUR, NOW - HOUR),
}


def _link_users(row, verified=True):
    account = {"id": ACCOUNT_ID, "email": EMAIL, "email_verified": verified,
               "password": "fixture-old-password-hash", "login_id": "fixture-old-login-id"}
    if LINK_ROWS[row] is not None:
        account["secrets"] = {"reset": copy.deepcopy(LINK_ROWS[row])}
    return Users(account)


def _link(users):
    return (users.docs[0].get("secrets") or {}).get("reset")


LINK_ISSUE = {
    "none": "issued",
    "sending, unexpired": ("wait", 30 * 60 + 3600),
    "sending, expired": "issued",
    "live, unexpired": ("wait", 30 * 60 + 3600),
    "live, expired, wait ahead": ("wait", 59 * 60),
    "live, expired, wait passed": "issued",
    "used": "issued",
    "discarded, wait ahead": ("wait", 59 * 60),
    "discarded, wait passed": "issued",
}


@pytest.mark.parametrize("row", list(LINK_ROWS), ids=list(LINK_ROWS))
def test_issue_a_link(clock, row):
    users = _link_users(row)
    before = copy.deepcopy(_link(users))

    answer = account_secrets.issue(users, RESET, users.docs[0])

    if LINK_ISSUE[row] == "issued":
        assert isinstance(answer, Issued)
        assert _link(users) == {"hash": account_secrets.hash_link(answer.secret),
                                "expires_at": NOW + HOUR, "next_allowed_at": None, "tries": 0,
                                "state": SENDING}
    else:
        assert answer == Wait(seconds=LINK_ISSUE[row][1])
        assert _link(users) == before


def test_a_link_is_issued_to_an_address_never_verified(clock):
    users = _link_users("none", verified=False)

    assert isinstance(account_secrets.issue(users, RESET, users.docs[0]), Issued)
    assert _link(users)["state"] == SENDING


def test_accepted_makes_the_link_live_with_its_wait(clock):
    users = _link_users("none")
    issued = account_secrets.issue(users, RESET, users.docs[0])

    account_secrets.accepted(users, RESET, issued)

    assert _link(users) == {"hash": issued.hash, "expires_at": NOW + HOUR,
                            "next_allowed_at": NOW + 2 * HOUR, "tries": 0, "state": LIVE}


def test_refused_unsets_the_link(clock):
    users = _link_users("none")
    issued = account_secrets.issue(users, RESET, users.docs[0])

    account_secrets.refused(users, RESET, issued)

    assert _link(users) is None


@pytest.mark.parametrize("answer", ["accepted", "refused"])
def test_a_provider_answer_past_the_links_life_writes_nothing(clock, answer):
    users = _link_users("none")
    issued = account_secrets.issue(users, RESET, users.docs[0])
    clock["at"] = NOW + HOUR + MINUTE
    before = copy.deepcopy(_link(users))

    getattr(account_secrets, answer)(users, RESET, issued)

    assert _link(users) == before


OTHER_LINK_ROWS = [row for row in LINK_ROWS if not row.startswith("sending")]


@pytest.mark.parametrize("answer", ["accepted", "refused"])
@pytest.mark.parametrize("row", OTHER_LINK_ROWS, ids=OTHER_LINK_ROWS)
def test_a_provider_answer_for_a_link_no_longer_held_writes_nothing(clock, row, answer):
    users = _link_users(row)
    before = copy.deepcopy(users.docs)
    elsewhere = Issued(account_id=ACCOUNT_ID, secret=THE_LINK,
                       hash=account_secrets.hash_link(THE_LINK), expires_at=NOW + HOUR)

    getattr(account_secrets, answer)(users, RESET, elsewhere)

    assert users.docs == before


# link used: the reset, in one write, and only by a live link.

LINK_USED = {
    "none": Link.INVALID,
    "sending, unexpired": Link.INVALID,
    "sending, expired": Link.INVALID,
    "live, unexpired": Link.LIVE,
    "live, expired, wait ahead": Link.EXPIRED,
    "live, expired, wait passed": Link.EXPIRED,
    "used": Link.INVALID,
    "discarded, wait ahead": Link.INVALID,
    "discarded, wait passed": Link.INVALID,
}


@pytest.mark.parametrize("row", list(LINK_ROWS), ids=list(LINK_ROWS))
def test_link_used(clock, row):
    users = _link_users(row, verified=False)
    before = copy.deepcopy(users.docs)

    found = account_secrets.find_link(users, RESET, THE_LINK)
    reset = account_secrets.use_reset_link(users, THE_LINK, PASSWORD_HASH, LOGIN_ID)

    assert found is LINK_USED[row]
    if found is Link.LIVE:
        assert reset == ACCOUNT_ID
        [account] = users.docs
        assert (account["password"], account["login_id"], account["email_verified"]) == (
            PASSWORD_HASH, LOGIN_ID, True)
        assert _link(users) == {**LINK_ROWS[row], "state": USED, "next_allowed_at": None}
    else:
        assert reset is None
        assert users.docs == before


def test_a_link_not_the_one_stored_is_invalid_and_resets_nothing(clock):
    users = _link_users("live, unexpired")
    before = copy.deepcopy(users.docs)

    assert account_secrets.find_link(users, RESET, NOT_THE_LINK) is Link.INVALID
    assert account_secrets.use_reset_link(users, NOT_THE_LINK, PASSWORD_HASH, LOGIN_ID) is None
    assert users.docs == before


def test_a_link_expiring_between_its_read_and_its_use_resets_nothing(clock):
    users = _link_users("live, unexpired")
    assert account_secrets.find_link(users, RESET, THE_LINK) is Link.LIVE
    clock["at"] = NOW + 30 * MINUTE
    before = copy.deepcopy(users.docs)

    assert account_secrets.use_reset_link(users, THE_LINK, PASSWORD_HASH, LOGIN_ID) is None
    assert users.docs == before


def test_of_two_uses_of_one_link_one_resets(clock):
    users = _link_users("live, unexpired")

    assert [account_secrets.use_reset_link(users, THE_LINK, password, LOGIN_ID)
            for password in ("fixture-first-hash", "fixture-second-hash")] == [ACCOUNT_ID, None]
    assert users.docs[0]["password"] == "fixture-first-hash"


# The verification link's rows.

def _verify_record(state, expires_at, next_allowed_at):
    return {"hash": account_secrets.hash_link(THE_LINK), "expires_at": expires_at,
            "next_allowed_at": next_allowed_at, "tries": 0, "state": state}


#: Every state the verification link's record can be in, by name; None is no record. A link mailed
#: 30 minutes ago is live, unexpired, with its ``next_allowed_at`` passed when it was mailed.
VERIFY_ROWS = {
    "none": None,
    "sending, unexpired": _verify_record(SENDING, NOW + 30 * MINUTE, None),
    "sending, expired": _verify_record(SENDING, NOW - MINUTE, None),
    "live, unexpired": _verify_record(LIVE, NOW + 30 * MINUTE, NOW - 30 * MINUTE),
    "live, expired": _verify_record(LIVE, NOW - HOUR, NOW - 2 * HOUR),
    "used": _verify_record(USED, NOW - MINUTE, None),
    "discarded, wait ahead": _verify_record(DISCARDED, NOW - MINUTE, NOW + 59 * MINUTE),
    "discarded, wait passed": _verify_record(DISCARDED, NOW - 2 * HOUR, NOW - HOUR),
}


def _verify_users(row, verified=False):
    account = {"id": ACCOUNT_ID, "email": EMAIL, "email_verified": verified,
               "password": "fixture-old-password-hash", "login_id": "fixture-old-login-id"}
    if VERIFY_ROWS[row] is not None:
        account["secrets"] = {"verify": copy.deepcopy(VERIFY_ROWS[row])}
    return Users(account)


def _verify(users):
    return (users.docs[0].get("secrets") or {}).get("verify")


VERIFY_ISSUE = {
    "none": "issued",
    "sending, unexpired": ("wait", 30 * 60),
    "sending, expired": "issued",
    "live, unexpired": "issued",
    "live, expired": "issued",
    "used": "issued",
    "discarded, wait ahead": ("wait", 59 * 60),
    "discarded, wait passed": "issued",
}


@pytest.mark.parametrize("row", list(VERIFY_ROWS), ids=list(VERIFY_ROWS))
def test_issue_a_verification_link(clock, row):
    users = _verify_users(row)
    before = copy.deepcopy(_verify(users))

    answer = account_secrets.issue(users, VERIFY, users.docs[0])

    if VERIFY_ISSUE[row] == "issued":
        assert isinstance(answer, Issued)
        assert _verify(users) == {"hash": account_secrets.hash_link(answer.secret),
                                  "expires_at": NOW + HOUR, "next_allowed_at": None, "tries": 0,
                                  "state": SENDING}
    else:
        assert answer == Wait(seconds=VERIFY_ISSUE[row][1])
        assert _verify(users) == before


def test_no_verification_link_is_issued_to_a_verified_address(clock):
    users = _verify_users("none", verified=True)

    assert account_secrets.issue(users, VERIFY, users.docs[0]) is None
    assert _verify(users) is None


def test_a_new_account_is_stored_holding_its_link_being_mailed(clock):
    issued, fields = account_secrets.issue_with_a_new_account(VERIFY, ACCOUNT_ID)
    users = Users({"id": ACCOUNT_ID, "email": EMAIL, "email_verified": False, **fields})

    assert (issued.account_id, issued.expires_at) == (ACCOUNT_ID, NOW + HOUR)
    assert _verify(users) == {"hash": account_secrets.hash_link(issued.secret),
                              "expires_at": NOW + HOUR, "next_allowed_at": None, "tries": 0,
                              "state": SENDING}

    account_secrets.accepted(users, VERIFY, issued)

    assert _verify(users)["state"] == LIVE


def test_accepted_makes_the_verification_link_live_with_no_wait(clock):
    users = _verify_users("none")
    issued = account_secrets.issue(users, VERIFY, users.docs[0])
    clock["at"] = NOW + MINUTE

    account_secrets.accepted(users, VERIFY, issued)

    assert _verify(users) == {"hash": issued.hash, "expires_at": NOW + HOUR,
                              "next_allowed_at": NOW + MINUTE, "tries": 0, "state": LIVE}
    assert isinstance(account_secrets.issue(users, VERIFY, users.docs[0]), Issued)


def test_refused_unsets_the_verification_link(clock):
    users = _verify_users("live, unexpired")
    issued = account_secrets.issue(users, VERIFY, users.docs[0])

    account_secrets.refused(users, VERIFY, issued)

    assert _verify(users) is None


@pytest.mark.parametrize("answer", ["accepted", "refused"])
def test_a_provider_answer_past_the_verification_links_life_writes_nothing(clock, answer):
    users = _verify_users("none")
    issued = account_secrets.issue(users, VERIFY, users.docs[0])
    clock["at"] = NOW + HOUR + MINUTE
    before = copy.deepcopy(_verify(users))

    getattr(account_secrets, answer)(users, VERIFY, issued)

    assert _verify(users) == before


OTHER_VERIFY_ROWS = [row for row in VERIFY_ROWS if not row.startswith("sending")]


@pytest.mark.parametrize("answer", ["accepted", "refused"])
@pytest.mark.parametrize("row", OTHER_VERIFY_ROWS, ids=OTHER_VERIFY_ROWS)
def test_a_provider_answer_for_a_verification_link_no_longer_held_writes_nothing(
    clock, row, answer,
):
    users = _verify_users(row)
    before = copy.deepcopy(users.docs)
    elsewhere = Issued(account_id=ACCOUNT_ID, secret=THE_LINK,
                       hash=account_secrets.hash_link(THE_LINK), expires_at=NOW + HOUR)

    getattr(account_secrets, answer)(users, VERIFY, elsewhere)

    assert users.docs == before


# link used: the address verified, in one write, and only by a live link.

VERIFY_USED = {
    "none": Link.INVALID,
    "sending, unexpired": Link.INVALID,
    "sending, expired": Link.INVALID,
    "live, unexpired": Link.LIVE,
    "live, expired": Link.EXPIRED,
    "used": Link.INVALID,
    "discarded, wait ahead": Link.INVALID,
    "discarded, wait passed": Link.INVALID,
}


@pytest.mark.parametrize("row", list(VERIFY_ROWS), ids=list(VERIFY_ROWS))
def test_verification_link_used(clock, row):
    users = _verify_users(row)
    before = copy.deepcopy(users.docs)

    found = account_secrets.find_link(users, VERIFY, THE_LINK)
    already = account_secrets.use_verification_link(users, THE_LINK)

    assert found is VERIFY_USED[row]
    if found is Link.LIVE:
        assert already is False
        assert users.docs[0]["email_verified"] is True
        assert _verify(users) == {**VERIFY_ROWS[row], "state": USED, "next_allowed_at": None}
    else:
        assert already is None
        assert users.docs == before


def test_a_verification_link_not_the_one_stored_is_invalid_and_verifies_nothing(clock):
    users = _verify_users("live, unexpired")
    before = copy.deepcopy(users.docs)

    assert account_secrets.find_link(users, VERIFY, NOT_THE_LINK) is Link.INVALID
    assert account_secrets.use_verification_link(users, NOT_THE_LINK) is None
    assert users.docs == before


def test_a_reset_link_is_not_a_verification_link(clock):
    users = _link_users("live, unexpired", verified=False)
    before = copy.deepcopy(users.docs)

    assert account_secrets.find_link(users, VERIFY, THE_LINK) is Link.INVALID
    assert account_secrets.use_verification_link(users, THE_LINK) is None
    assert users.docs == before


def test_of_two_uses_of_one_verification_link_one_uses_it(clock):
    users = _verify_users("live, unexpired")

    assert [account_secrets.use_verification_link(users, THE_LINK) for _ in range(2)] == [
        False, None]


def test_a_live_link_on_an_address_verified_meanwhile_is_used_and_says_so(clock):
    users = _verify_users("live, unexpired", verified=True)

    assert account_secrets.use_verification_link(users, THE_LINK) is True
    assert _verify(users)["state"] == USED


# password reset, over the verification link: a reset ends it, whatever state it is in.

@pytest.mark.parametrize("row", list(VERIFY_ROWS), ids=list(VERIFY_ROWS))
def test_a_password_reset_ends_the_verification_link(clock, row):
    users = _with_a_live_link(_verify_users(row))

    assert account_secrets.use_reset_link(users, THE_LINK, PASSWORD_HASH, LOGIN_ID) == ACCOUNT_ID

    assert _verify(users) is None
    assert users.docs[0]["email_verified"] is True


# operator verify: the address verified by hand, its link ended, whatever state it is in.

@pytest.mark.parametrize("row", list(VERIFY_ROWS), ids=list(VERIFY_ROWS))
def test_verified_by_hand(clock, row):
    users = _verify_users(row)

    assert account_secrets.verify_by_hand(users, EMAIL) is True

    assert _verify(users) is None
    assert users.docs[0]["email_verified"] is True


def test_verifying_by_hand_an_address_with_no_account_says_so(clock):
    users = _verify_users("none")

    assert account_secrets.verify_by_hand(users, "fixture-nobody@example.com") is False
