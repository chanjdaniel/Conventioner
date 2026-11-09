"""The counters that bound the sign-in endpoints, the applicant's and the organizer's.

A counter lives in the database, not in a process: a serverless deployment runs many processes and
forgets each one, so a limit kept in memory bounds nothing. These tests hold the limiter to that
shape with a fake collection that behaves as Mongo's upsert does (``conftest.FakeAttemptsCollection``).
"""
from datetime import datetime, timedelta, timezone

import pytest
from flask import Flask, jsonify

import sign_in_limits
from sign_in_limits import (
    SignInLimit, caller, count_attempt, take_back_attempt, too_many, wait_in_words,
)


THREE_A_MINUTE = SignInLimit("test", attempts=3, window=timedelta(minutes=1))
# 30 seconds into a minute-long window, so the window ends 30 seconds from now.
NOW = datetime(2026, 10, 22, 12, 0, 30, tzinfo=timezone.utc)


def test_attempts_up_to_the_limit_are_allowed(sign_in_attempts):
    assert [count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW) for _ in range(3)] == [
        None, None, None,
    ]


def test_the_attempt_past_the_limit_is_told_when_the_window_ends(sign_in_attempts):
    for _ in range(3):
        count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW)
    assert count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW) == 30


def test_a_refused_attempt_still_counts(sign_in_attempts):
    """A caller who keeps knocking stays refused for the rest of the window."""
    for _ in range(5):
        count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW)
    assert count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW + timedelta(seconds=29)) == 1


def test_the_wait_is_never_less_than_a_second(sign_in_attempts):
    almost_over = datetime(2026, 10, 22, 12, 0, 59, 999000, tzinfo=timezone.utc)
    for _ in range(3):
        count_attempt(THREE_A_MINUTE, "a@example.com", now=almost_over)
    assert count_attempt(THREE_A_MINUTE, "a@example.com", now=almost_over) == 1


def test_each_subject_is_counted_apart(sign_in_attempts):
    for _ in range(3):
        count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW)
    assert count_attempt(THREE_A_MINUTE, "b@example.com", now=NOW) is None


def test_each_limit_is_counted_apart(sign_in_attempts):
    other = SignInLimit("other", attempts=3, window=timedelta(minutes=1))
    for _ in range(3):
        count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW)
    assert count_attempt(other, "a@example.com", now=NOW) is None


def test_the_next_window_starts_from_nothing(sign_in_attempts):
    for _ in range(4):
        count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW)
    assert count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW + timedelta(minutes=1)) is None


def test_a_counter_expires_when_its_window_ends(sign_in_attempts):
    """The TTL index removes it; nothing in the application cleans up."""
    count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW)
    [doc] = sign_in_attempts.docs.values()
    assert doc["expires_at"] == datetime(2026, 10, 22, 12, 1, 0, tzinfo=timezone.utc)


def test_a_counter_names_no_address_and_no_caller(sign_in_attempts):
    """The counters hold who knocked for a quarter of an hour; they need not hold who it was."""
    count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW)
    count_attempt(THREE_A_MINUTE, "203.0.113.7", now=NOW)
    stored = repr(sign_in_attempts.docs)
    assert "a@example.com" not in stored
    assert "203.0.113.7" not in stored


def test_the_expiry_index_removes_a_counter_once_its_window_ends(sign_in_attempts):
    sign_in_limits.ensure_expiry_index()
    assert sign_in_attempts.indexes == [
        ([("expires_at", 1)], {"expireAfterSeconds": 0, "name": "sign_in_attempt_ttl"}),
    ]


def test_every_limit_fits_a_real_applicant():
    """A vendor who mistypes or asks again is never near a limit; a flood is."""
    for limit in sign_in_limits.LIMITS:
        assert limit.attempts >= 5
        assert limit.window <= timedelta(minutes=15)


# Taking a try back: a try that signs in returns its count, so only wrong tries pile up.

def test_a_try_taken_back_lowers_its_windows_count_by_one(sign_in_attempts):
    for _ in range(3):
        count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW)

    take_back_attempt(THREE_A_MINUTE, "a@example.com", NOW)

    assert count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW) is None
    assert count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW) == 30


def test_a_count_is_never_taken_below_nothing(sign_in_attempts):
    count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW)

    take_back_attempt(THREE_A_MINUTE, "a@example.com", NOW)
    take_back_attempt(THREE_A_MINUTE, "a@example.com", NOW)

    [doc] = sign_in_attempts.docs.values()
    assert doc["count"] == 0


def test_taking_a_try_back_touches_only_its_own_window(sign_in_attempts):
    count_attempt(THREE_A_MINUTE, "a@example.com", now=NOW)
    later = NOW + timedelta(minutes=1)
    count_attempt(THREE_A_MINUTE, "a@example.com", now=later)

    take_back_attempt(THREE_A_MINUTE, "a@example.com", later)

    assert sorted(doc["count"] for doc in sign_in_attempts.docs.values()) == [0, 1]


def test_taking_a_try_back_from_a_removed_counter_writes_nothing(sign_in_attempts):
    take_back_attempt(THREE_A_MINUTE, "a@example.com", NOW)

    assert sign_in_attempts.docs == {}


# The wait, in words.

def test_a_wait_is_said_in_whole_minutes_rounded_up():
    assert [wait_in_words(s) for s in (1, 60, 61, 120, 900)] == [
        "1 minute", "1 minute", "2 minutes", "2 minutes", "15 minutes",
    ]


def test_a_refusal_says_its_sentence_with_the_wait_and_retry_after():
    with Flask(__name__).app_context():
        response, status = too_many(61, "Try again in {wait}.", key="msg")

    assert status == 429
    assert response.get_json() == {"msg": "Try again in 2 minutes."}
    assert response.headers["Retry-After"] == "61"


def test_no_refusal_when_the_limit_did_not_refuse():
    assert too_many(None, "Try again in {wait}.") is None


@pytest.mark.parametrize("retry_after, wait", [(60, "1 minute"), (899, "15 minutes")])
def test_the_applicants_and_the_check_ins_refusals_keep_their_words(retry_after, wait):
    """Their sentence moved into a template; what a vendor reads did not change by a byte."""
    import api.applicant_auth as applicant_auth
    import api.vendor_check_in as vendor_check_in

    with Flask(__name__).app_context():
        sign_in, _ = applicant_auth._too_many(retry_after)
        check_in, _ = vendor_check_in._too_many(retry_after)
        assert sign_in.get_data() == jsonify(
            {"message": f"Too many sign-in attempts. Please try again in {wait}."}).get_data()
        assert check_in.get_data() == jsonify(
            {"error": f"Too many check-in attempts. Please try again in {wait}."}).get_data()


def test_the_organizers_password_sign_in_is_limited_per_address_and_per_caller():
    assert sign_in_limits.PASSWORD_PER_ADDRESS == SignInLimit(
        "password:address", attempts=10, window=timedelta(minutes=15))
    assert sign_in_limits.PASSWORD_PER_CALLER == SignInLimit(
        "password:caller", attempts=50, window=timedelta(minutes=15))
    assert {sign_in_limits.PASSWORD_PER_ADDRESS, sign_in_limits.PASSWORD_PER_CALLER} <= set(
        sign_in_limits.LIMITS)


def test_the_organizers_code_sign_in_is_limited_per_address_and_per_caller():
    assert sign_in_limits.ORGANIZER_CODE_PER_ADDRESS == SignInLimit(
        "organizer-code:address", attempts=10, window=timedelta(minutes=15))
    assert sign_in_limits.ORGANIZER_CODE_PER_CALLER == SignInLimit(
        "organizer-code:caller", attempts=60, window=timedelta(minutes=15))
    assert {sign_in_limits.ORGANIZER_CODE_PER_ADDRESS,
            sign_in_limits.ORGANIZER_CODE_PER_CALLER} <= set(sign_in_limits.LIMITS)


@pytest.mark.parametrize("prefix, name", [
    ("ORGANIZER_CODE_REQUEST", "organizer-code-request"),
    ("RESET_LINK", "reset-link"),
    ("VERIFICATION_LINK", "verification-link"),
    ("SIGN_UP", "sign-up"),
])
def test_each_organizer_mail_request_is_limited_per_address_and_per_caller(prefix, name):
    per_address = getattr(sign_in_limits, f"{prefix}_PER_ADDRESS")
    per_caller = getattr(sign_in_limits, f"{prefix}_PER_CALLER")
    assert per_address == SignInLimit(f"{name}:address", attempts=5, window=timedelta(minutes=15))
    assert per_caller == SignInLimit(f"{name}:caller", attempts=30, window=timedelta(minutes=15))
    assert {per_address, per_caller} <= set(sign_in_limits.LIMITS)


def test_every_limit_has_a_name_of_its_own():
    names = [limit.name for limit in sign_in_limits.LIMITS]
    assert len(names) == len(set(names))


def test_the_caller_is_the_address_the_request_came_from():
    app = Flask(__name__)
    with app.test_request_context("/", environ_base={"REMOTE_ADDR": "203.0.113.7"}):
        assert caller() == "203.0.113.7"
    with app.test_request_context("/", environ_base={"REMOTE_ADDR": ""}):
        assert caller() == "unknown"
