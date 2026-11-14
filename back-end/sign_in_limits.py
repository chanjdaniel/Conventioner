"""Single owner of the ``sign_in_attempts`` collection: how often a caller may ask to sign in.

Every sign-in endpoint is public: the applicant's code sign-in, the organizer's password and code
sign-ins and the requests that mail an organizer a code or a link, the sign-up among them, and the
vendor's check-in at the door. A request that sends an email, left unbounded, could flood
any address with mail, spending the sender's money and reputation; a sign-in try is a guess at a
password or a code. Each limit here is counted per address, per caller or both, small enough to
stop that and far above what a vendor or an organizer who mistypes or asks again ever reaches.
Where a try that signs in is taken back (``take_back_attempt``), only wrong tries pile up.

**The counters live in the database, never in a process.** A serverless deployment runs many
processes and freezes or discards each at will, so a counter held in memory bounds nothing. Each
window is one document, counted with an atomic ``$inc`` upsert, and removed by the TTL index once
its window has ended; nothing in the application cleans up. The window is fixed and aligned to the
clock, so a document's key names its window and a counter Mongo has not yet removed is never read
again.

**A counter names nobody.** Its key is a hash of the limit, the subject and the window: the
collection holds how many times someone knocked in the last quarter of an hour, not who.

**A limit is the same for every address**, with an account or an application or neither, and it
is counted before the account or the market is looked up, so a refusal says nothing about who has
an account, who has applied or which markets exist (the applicant login ruling,
``api/applicant_auth.py``). It is also not the attempt counter that ruling forbids: that one
existed only for addresses that had applied, and so answered whether they had.
"""
import hashlib
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Tuple

from flask import jsonify, request
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


# Every limit, in one place. A vendor asks for a code, perhaps once more, and enters it; vendors on
# one venue's wifi share an address, so a caller is allowed far more than an address is. What bounds
# a guess at a code, and the mail one address is sent, stays the per-address limit.
REQUEST_CODE_PER_ADDRESS = SignInLimit("request-code:address", attempts=5, window=timedelta(minutes=15))
REQUEST_CODE_PER_CALLER = SignInLimit("request-code:caller", attempts=300, window=timedelta(minutes=15))
VERIFY_CODE_PER_ADDRESS = SignInLimit("verify-code:address", attempts=10, window=timedelta(minutes=15))
VERIFY_CODE_PER_CALLER = SignInLimit("verify-code:caller", attempts=300, window=timedelta(minutes=15))
# A remembered vendor's page asks once per visit (``applicant-login/resume``). Its secret is not to
# be guessed, so this bounds the work a caller makes the database do, not a guess.
RESUME_PER_CALLER = SignInLimit("resume:caller", attempts=300, window=timedelta(minutes=15))
# A vendor checking in on their page sends the door code (``api/vendor_check_in.py``): every try is
# bounded per signed-in address, and by nothing per caller. A venue's wifi is one caller for every
# vendor there, and a count of its wrong codes refused a right code after strangers' wrong ones, so
# it was dropped (T318); the counters it left under ``check-in:caller`` are never read and expire.
# The sign-in for the market and a seat on a day in reach bound a guess with this limit.
CHECK_IN_PER_ADDRESS = SignInLimit("check-in:address", attempts=10, window=timedelta(minutes=15))
# An organizer's password sign-in (``api/users.py``, ``/login``): every try is counted before the
# account is looked up, and a try that signs in, or proves the password of an account not yet
# verified, is taken back, so an organizer who signs in all day is never held back and only wrong
# passwords pile up. Organizers on a venue's shared address share the caller's count, so it is
# far above what a few of them mistyping reach.
PASSWORD_PER_ADDRESS = SignInLimit("password:address", attempts=10, window=timedelta(minutes=15))
PASSWORD_PER_CALLER = SignInLimit("password:caller", attempts=50, window=timedelta(minutes=15))
# An organizer's code sign-in (``/login-otp``) is bounded as the password is, with a right code
# taken back; its numbers are the applicant's verify-code's, with the caller's set as the door's.
# A code's own five tries are counted on the account, which this limit does not replace.
ORGANIZER_CODE_PER_ADDRESS = SignInLimit(
    "organizer-code:address", attempts=10, window=timedelta(minutes=15))
ORGANIZER_CODE_PER_CALLER = SignInLimit(
    "organizer-code:caller", attempts=60, window=timedelta(minutes=15))
# The organizer's requests that send a mail (``api/users.py``): a sign-in code (``/request-otp``),
# a reset link, a verification link, and the sign-up's own link. Every request counts and none is
# taken back: an organizer asks once, perhaps again, so five bound the mail one address is sent,
# and a caller is allowed thirty for organizers who share a venue's address. Each request has its
# own pair, so each refusal names its request and one request's use holds back no other.
ORGANIZER_CODE_REQUEST_PER_ADDRESS = SignInLimit(
    "organizer-code-request:address", attempts=5, window=timedelta(minutes=15))
ORGANIZER_CODE_REQUEST_PER_CALLER = SignInLimit(
    "organizer-code-request:caller", attempts=30, window=timedelta(minutes=15))
RESET_LINK_PER_ADDRESS = SignInLimit("reset-link:address", attempts=5, window=timedelta(minutes=15))
RESET_LINK_PER_CALLER = SignInLimit("reset-link:caller", attempts=30, window=timedelta(minutes=15))
VERIFICATION_LINK_PER_ADDRESS = SignInLimit(
    "verification-link:address", attempts=5, window=timedelta(minutes=15))
VERIFICATION_LINK_PER_CALLER = SignInLimit(
    "verification-link:caller", attempts=30, window=timedelta(minutes=15))
SIGN_UP_PER_ADDRESS = SignInLimit("sign-up:address", attempts=5, window=timedelta(minutes=15))
SIGN_UP_PER_CALLER = SignInLimit("sign-up:caller", attempts=30, window=timedelta(minutes=15))

LIMITS = (
    REQUEST_CODE_PER_ADDRESS,
    REQUEST_CODE_PER_CALLER,
    VERIFY_CODE_PER_ADDRESS,
    VERIFY_CODE_PER_CALLER,
    RESUME_PER_CALLER,
    CHECK_IN_PER_ADDRESS,
    PASSWORD_PER_ADDRESS,
    PASSWORD_PER_CALLER,
    ORGANIZER_CODE_PER_ADDRESS,
    ORGANIZER_CODE_PER_CALLER,
    ORGANIZER_CODE_REQUEST_PER_ADDRESS,
    ORGANIZER_CODE_REQUEST_PER_CALLER,
    RESET_LINK_PER_ADDRESS,
    RESET_LINK_PER_CALLER,
    VERIFICATION_LINK_PER_ADDRESS,
    VERIFICATION_LINK_PER_CALLER,
    SIGN_UP_PER_ADDRESS,
    SIGN_UP_PER_CALLER,
)


def caller() -> str:
    """Who is asking: the address the request came from, as ``ProxyFix`` settled it by
    ``TRUSTED_PROXY_HOPS``. Every per-caller limit names its caller this one way."""
    return request.remote_addr or "unknown"


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


def take_back_attempt(limit: SignInLimit, subject: str, now: datetime) -> None:
    """Take back one attempt ``count_attempt`` counted, for a try that signed in.

    ``now`` is the one the attempt was counted with, so the try leaves the window it was counted
    in. The count never goes below zero, and a counter already removed is left removed.
    """
    key, _ = _window(limit, subject, now)
    attempts_collection.update_one({"_id": key, COUNT_FIELD: {"$gt": 0}}, {"$inc": {COUNT_FIELD: -1}})


def wait_in_words(seconds: int) -> str:
    """A wait as a person reads it: whole minutes, rounded up."""
    minutes = math.ceil(seconds / 60)
    return "1 minute" if minutes == 1 else f"{minutes} minutes"


def too_many(
    retry_after: Optional[int], sentence: str, key: str = "message",
) -> Optional[Tuple[Any, int]]:
    """The 429 for a limit ``count_attempt`` refused, or None when it did not refuse.

    ``sentence`` says plainly how long to wait, with ``{wait}`` where the wait goes
    (``wait_in_words``), under ``key``, the one each caller's screen reads its refusals from (the
    sign-in reads ``message``, the check-in ``error``), with the seconds in ``Retry-After``. One
    refusal for every limit, so the sign-ins' and the check-in's never drift apart.
    """
    if retry_after is None:
        return None
    response = jsonify({key: sentence.format(wait=wait_in_words(retry_after))})
    response.headers["Retry-After"] = str(retry_after)
    return response, 429
