"""Single owner of the ``sign_in_attempts`` collection: how often a caller may ask to sign in.

The applicant sign-in endpoints are public. Each code request sends an email, so a caller left
unbounded could use this product to flood any address with mail, spending the sender's money and
reputation; each verify attempt is a guess at a six-digit code. Every limit here is counted per
address and per caller, small enough to stop that and far above what a vendor who mistypes or asks
again ever reaches.

**The counters live in the database, never in a process.** A serverless deployment runs many
processes and freezes or discards each at will, so a counter held in memory bounds nothing. Each
window is one document, counted with an atomic ``$inc`` upsert, and removed by the TTL index once
its window has ended; nothing in the application cleans up. The window is fixed and aligned to the
clock, so a document's key names its window and a counter Mongo has not yet removed is never read
again.

**A counter names nobody.** Its key is a hash of the limit, the subject and the window: the
collection holds how many times someone knocked in the last quarter of an hour, not who.

**A limit is the same for every address**, applicant or not, and the caller is counted before the
market is looked up, so a refusal says nothing about who has applied or which markets exist (the
applicant login ruling, ``api/applicant_auth.py``). It is also not the attempt counter that ruling
forbids: that one existed only for addresses that had applied, and so answered whether they had.
"""
import hashlib
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Tuple

from flask import jsonify
from pymongo import ReturnDocument

from db_config import get_database

SIGN_IN_ATTEMPTS_COLLECTION = "sign_in_attempts"
COUNT_FIELD = "count"
EXPIRES_AT_FIELD = "expires_at"

db = get_database()
attempts_collection = db[SIGN_IN_ATTEMPTS_COLLECTION]


@dataclass(frozen=True)
class SignInLimit:
    """At most ``attempts`` in each ``window``, for each subject (an address, or a caller)."""

    name: str
    attempts: int
    window: timedelta


# Every limit, in one place. A vendor asks for a code, perhaps once more, and enters it; a shared
# network (an office, a venue) may hold several vendors at once, so a caller is allowed more than
# an address.
REQUEST_CODE_PER_ADDRESS = SignInLimit("request-code:address", attempts=5, window=timedelta(minutes=15))
REQUEST_CODE_PER_CALLER = SignInLimit("request-code:caller", attempts=30, window=timedelta(minutes=15))
VERIFY_CODE_PER_ADDRESS = SignInLimit("verify-code:address", attempts=10, window=timedelta(minutes=15))
VERIFY_CODE_PER_CALLER = SignInLimit("verify-code:caller", attempts=60, window=timedelta(minutes=15))
# A remembered vendor's page asks once per visit (``applicant-login/resume``). Its secret is not to
# be guessed, so this bounds the work a caller makes the database do, not a guess.
RESUME_PER_CALLER = SignInLimit("resume:caller", attempts=60, window=timedelta(minutes=15))
# A vendor checking in on their page sends the door code (``api/vendor_check_in.py``): every try is
# bounded per signed-in address, and only the WRONG codes are bounded per caller, so a vendor at
# home cannot guess the code from the poster's alphabet while a venue's shared address still checks
# every vendor in.
CHECK_IN_PER_ADDRESS = SignInLimit("check-in:address", attempts=10, window=timedelta(minutes=15))
CHECK_IN_PER_CALLER = SignInLimit("check-in:caller", attempts=60, window=timedelta(minutes=15))

LIMITS = (
    REQUEST_CODE_PER_ADDRESS,
    REQUEST_CODE_PER_CALLER,
    VERIFY_CODE_PER_ADDRESS,
    VERIFY_CODE_PER_CALLER,
    RESUME_PER_CALLER,
    CHECK_IN_PER_ADDRESS,
    CHECK_IN_PER_CALLER,
)


def ensure_expiry_index() -> None:
    """Build the TTL index that removes a counter once its window has ended.

    Raises ``PyMongoError`` when it cannot; the applicant login boot check
    (``api.applicant_auth.ensure_applicant_login_indexes``) refuses to start on it.
    """
    attempts_collection.create_index(
        [(EXPIRES_AT_FIELD, 1)],
        expireAfterSeconds=0,
        name="sign_in_attempt_ttl",
    )


def _window(limit: SignInLimit, subject: str, now: datetime) -> Tuple[str, datetime]:
    """The counter key and end of the window ``now`` falls in."""
    window_seconds = limit.window.total_seconds()
    window = math.floor(now.timestamp() / window_seconds)
    window_ends = datetime.fromtimestamp((window + 1) * window_seconds, tz=timezone.utc)
    key = hashlib.sha256(f"{limit.name}\0{subject}\0{window}".encode()).hexdigest()
    return key, window_ends


def over_limit(limit: SignInLimit, subject: str, now: Optional[datetime] = None) -> Optional[int]:
    """Whether ``subject`` is already past ``limit``, without counting anything.

    Returns None while the window's count is within the limit, and otherwise the whole seconds
    until the window ends, as ``count_attempt`` does.
    """
    now = now or datetime.now(timezone.utc)
    key, window_ends = _window(limit, subject, now)
    counter = attempts_collection.find_one({"_id": key})
    if not counter or counter[COUNT_FIELD] <= limit.attempts:
        return None
    return max(1, math.ceil((window_ends - now).total_seconds()))


def count_attempt(limit: SignInLimit, subject: str, now: Optional[datetime] = None) -> Optional[int]:
    """Count one attempt by ``subject`` against ``limit``.

    Returns None while the attempt is within the limit, and otherwise the whole seconds until the
    window ends, for a ``Retry-After``. A refused attempt is counted too, so a caller who keeps
    knocking stays refused until the window ends.
    """
    now = now or datetime.now(timezone.utc)
    key, window_ends = _window(limit, subject, now)
    counter = attempts_collection.find_one_and_update(
        {"_id": key},
        {"$inc": {COUNT_FIELD: 1}, "$setOnInsert": {EXPIRES_AT_FIELD: window_ends}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if counter[COUNT_FIELD] <= limit.attempts:
        return None
    return max(1, math.ceil((window_ends - now).total_seconds()))


def too_many(
    retry_after: Optional[int], attempts_of: str, key: str = "message",
) -> Optional[Tuple[Any, int]]:
    """The 429 for a limit ``count_attempt`` refused, or None when it did not refuse.

    It says plainly how long to wait, in whole minutes rounded up, under ``key``, the one each
    caller's screen reads its refusals from (the sign-in reads ``message``, the check-in ``error``),
    with the seconds in ``Retry-After``. One refusal for every limit, so the sign-in's and the
    check-in's never drift apart.
    """
    if retry_after is None:
        return None
    minutes = math.ceil(retry_after / 60)
    wait = "1 minute" if minutes == 1 else f"{minutes} minutes"
    response = jsonify({key: f"Too many {attempts_of} attempts. Please try again in {wait}."})
    response.headers["Retry-After"] = str(retry_after)
    return response, 429
