"""The counters that bound the applicant sign-in endpoints.

A counter lives in the database, not in a process: a serverless deployment runs many processes and
forgets each one, so a limit kept in memory bounds nothing. These tests hold the limiter to that
shape with a fake collection that behaves as Mongo's upsert does (``conftest.FakeAttemptsCollection``).
"""
from datetime import datetime, timedelta, timezone

import sign_in_limits
from sign_in_limits import SignInLimit, count_attempt


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
