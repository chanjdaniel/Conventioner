"""Applicant email-code login - the security boundary between a public form and a
private applicant list.

Every endpoint in this module is unauthenticated. Every line is attacker-facing.
The design is the captain's ruling in full - see the decision file at
``/home/danielc/.firstmate/data/decision-applicant-login-oracle.md``. The key
constraints:

1. **No attempt counter on an application.** A code is consumed by a single
   verification attempt, right or wrong. No "attempts remaining", and nothing
   counted only for addresses that applied: such a counter answers whether they
   had. The rate limits (``sign_in_limits``) count every address and every
   caller alike, before the market is looked up, so their refusal leaks nothing.

2. **Requesting a code is indistinguishable, always.** Same HTTP status, shape
   and body whether or not the address is known.

3. **Verifying a code is indistinguishable, always.** Every failure branch
   (unknown address, no code issued, expired, already consumed, wrong code)
   collapses to one observable response.

4. **Enforced on the back end.** The front end is 5e; this must stand alone.

5. **The login challenge lives in its own collection** keyed by ``(market_id, email)``,
   created for any address that requests a code - applicant or not. The
   ``Application`` document keeps engaging the D9 hard lock exactly as the
   captain specified.

6. **Timing is also a channel.** Identical response bodies are worthless if one
   path is measurably slower. Every address is sent its code (E26/F07/S01), so the
   work is the same for all, and the send runs on a thread so the response goes out
   as soon as the challenge is stored.

A first-time vendor signs in exactly as a returning one does: the token names the
address and the market, not an application, and their first save creates it.
"""
import hashlib
import logging
import math
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from flask import jsonify, request
from pymongo.errors import PyMongoError

import sign_in_limits
from db_config import get_database
from market_documents import applicant_intake_market_by_slug
from utils.email import _email_disabled, ready_mailer, from_email, frontend_url
from utils.application_token import generate_application_token
from utils.email_address import normalized_email

logger = logging.getLogger(__name__)

# ── Collection setup ──────────────────────────────────────────────────────

APPLICANT_LOGIN_CHALLENGES_COLLECTION = "applicant_login_challenges"
MARKET_ID_FIELD = "market_id"
EMAIL_FIELD = "email"
CONSUMED_FIELD = "consumed"
EXPIRES_AT_FIELD = "expires_at"

db = get_database()
challenges_collection = db[APPLICANT_LOGIN_CHALLENGES_COLLECTION]

_indexes_ready = False


class ApplicantLoginIndexError(RuntimeError):
    """The indexes that make one code one attempt are not in place."""


def ensure_applicant_login_indexes() -> None:
    """Build the indexes the applicant login endpoints rest on.

    Three indexes:
    1. A unique compound index on ``(market_id, email)`` so an address has at
       most one active challenge per market - a new request overwrites the old one.
    2. A TTL index on ``expires_at`` so expired challenges are cleaned up by
       the database, not by application code.
    3. The TTL index that expires the sign-in rate limit counters
       (``sign_in_limits``), without which they would pile up for ever.

    A build that fails raises, and the caller fails with it. This index is not
    a decoration; it is the guarantee that find_one_and_update with a consumed
    filter is atomic, and that a process serving on without it is silently
    allowing code replay.
    """
    global _indexes_ready
    if _indexes_ready:
        return
    try:
        # One challenge per (market, email) at a time.
        challenges_collection.create_index(
            [(MARKET_ID_FIELD, 1), (EMAIL_FIELD, 1)],
            unique=True,
            name="market_email_unique",
        )
        # TTL cleanup: MongoDB removes documents when expires_at passes.
        challenges_collection.create_index(
            [(EXPIRES_AT_FIELD, 1)],
            expireAfterSeconds=0,
            name="challenge_ttl",
        )
        sign_in_limits.ensure_expiry_index()
    except PyMongoError as exc:
        message = (
            f"The indexes on {APPLICANT_LOGIN_CHALLENGES_COLLECTION} and "
            f"{sign_in_limits.SIGN_IN_ATTEMPTS_COLLECTION} could not be built, so nothing "
            f"is enforcing one-code-one-attempt or cleaning up expired challenges and "
            f"rate limit counters: {exc}"
        )
        logger.critical("%s", message)
        raise ApplicantLoginIndexError(message) from exc
    _indexes_ready = True


# ── Code generation and verification ──────────────────────────────────────

CODE_LENGTH = 6
CODE_EXPIRY_MINUTES = 5


def _generate_code() -> str:
    """A 6-digit numeric login code."""
    return "".join(secrets.choice("0123456789") for _ in range(CODE_LENGTH))


def _code_expiry() -> datetime:
    """Naive UTC datetime CODE_EXPIRY_MINUTES from now."""
    return datetime.now(timezone.utc) + timedelta(minutes=CODE_EXPIRY_MINUTES)


def _hash_code(code: str) -> str:
    """Hash a code for storage so a compromised backup does not leak live codes."""
    salt = secrets.token_hex(16)
    digest = hashlib.sha256(f"{salt}:{code}".encode()).hexdigest()
    return f"{salt}:{digest}"


def _verify_code(stored: str, candidate: str) -> bool:
    """Constant-time comparison of a stored hash against a candidate code."""
    if ":" not in stored:
        return False
    salt, expected = stored.split(":", 1)
    actual = hashlib.sha256(f"{salt}:{candidate}".encode()).hexdigest()
    return secrets.compare_digest(expected, actual)


# ── Canonical responses ──────────────────────────────────────────────────

# These are the ONLY response bodies these endpoints return for their respective
# outcomes. Every caller gets the same bytes regardless of what the database holds.
# Stored as plain dicts because jsonify() requires an application context and
# cannot be called at module import time.

# True of every address, because every address is sent a code (E26/F07/S01). It hedged while codes
# went only to known ones, which was what kept a first-time vendor from ever signing in (bug 6).
_REQUEST_CODE_BODY = {"message": "We've sent a code to this address."}
_REQUEST_CODE_STATUS = 200

_VERIFY_FAILURE_BODY = {"message": "Invalid or expired code."}
_VERIFY_FAILURE_STATUS = 401


# ── Rate limits ──────────────────────────────────────────────────────────

def _refusal(caller_limit: sign_in_limits.SignInLimit,
             address_limit: sign_in_limits.SignInLimit,
             email: Optional[str]):
    """A 429 when this caller, or then this address, is past its limit; None otherwise.

    The caller is counted on every request, before the body or the slug says anything, so a
    refusal is the same for every address and every market, real or not. The address is counted
    only once the caller is within its limit. Either refusal says plainly how long to wait, and the
    sign-in screen shows the message as it stands.
    """
    caller = request.remote_addr or "unknown"
    retry_after = sign_in_limits.count_attempt(caller_limit, caller)
    if retry_after is None and email:
        retry_after = sign_in_limits.count_attempt(address_limit, email)
    if retry_after is None:
        return None
    minutes = math.ceil(retry_after / 60)
    wait = "1 minute" if minutes == 1 else f"{minutes} minutes"
    response = jsonify({"message": f"Too many sign-in attempts. Please try again in {wait}."})
    response.headers["Retry-After"] = str(retry_after)
    return response, 429


def _email_from(data) -> Optional[str]:
    """The normalised address a request names, or None when it names none."""
    if not isinstance(data, dict):
        return None
    email = normalized_email(data.get("email"))
    return email if email and "@" in email else None


# ── Email sending ─────────────────────────────────────────────────────────

def _send_code_email(email: str, code: str, market_name: str, market_slug: str) -> bool:
    """Send the sign-in code to the applicant's email address.

    It links to the market's own sign-in page, by its public address. It linked to
    ``/markets/<id>/login``, which the product has no page for (E26/F10/S02).

    Returns True when the email was accepted by the provider (or disabled in dev),
    False when it was not.
    """
    if _email_disabled():
        logger.info("DISABLE_EMAIL is enabled - skipping applicant login code email to %s", email)
        return True

    if not ready_mailer():
        logger.error("Cannot send applicant login code: RESEND_API_KEY not set")
        return False

    import resend

    base_url = frontend_url()
    login_url = f"{base_url}/{market_slug}/applicant-login"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your sign-in code</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #36826f;">Your sign-in code</h1>
        <p>You requested access to your application for <strong>{market_name}</strong>.</p>
        <div style="background-color: #f5f5f5; border: 2px dashed #36826f; padding: 20px; text-align: center; margin: 30px 0;">
            <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #36826f; margin: 0;">{code}</p>
        </div>
        <p>Enter it on <a href="{login_url}">the sign-in page</a> to see your application.</p>
        <p style="color: #777474; font-size: 12px; margin-top: 30px;">This code will expire in {CODE_EXPIRY_MINUTES} minutes and can only be used once.</p>
        <p style="color: #777474; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
    </body>
    </html>
    """

    text_content = f"""
    Your sign-in code

    You requested access to your application for "{market_name}".

    Your code: {code}

    Enter it on the sign-in page: {login_url}

    This code will expire in {CODE_EXPIRY_MINUTES} minutes and can only be used once.

    If you didn't request this code, please ignore this email.
    """

    try:
        response = resend.Emails.send({
            "from": from_email(),
            "to": [email],
            "subject": f"Your sign-in code for {market_name}",
            "html": html_content,
            "text": text_content,
        })
        if response and hasattr(response, "id"):
            logger.info("Applicant login code sent to %s for market %s", email, market_slug)
            return True
        logger.error("Applicant login code send returned unexpected response: %s", response)
        return False
    except Exception as e:
        logger.error("Error sending applicant login code to %s: %s - %s", email, type(e).__name__, e)
        return False


# ── Challenge storage ─────────────────────────────────────────────────────

def _store_challenge(market_id: str, email: str, code: str, expires_at: datetime) -> None:
    """Store (or overwrite) a login challenge for (market_id, email).

    The unique index on (market_id, email) means a new request overwrites any
    existing challenge - one code per address per market. The previous code is
    dead after this overwrite.
    """
    code_hash = _hash_code(code)
    challenges_collection.update_one(
        {MARKET_ID_FIELD: market_id, EMAIL_FIELD: email},
        {
            "$set": {
                MARKET_ID_FIELD: market_id,
                EMAIL_FIELD: email,
                "code_hash": code_hash,
                EXPIRES_AT_FIELD: expires_at,
                CONSUMED_FIELD: False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        },
        upsert=True,
    )


def _consume_and_verify(market_id: str, email: str, candidate_code: str) -> bool:
    """Atomically consume a challenge and verify the code.

    Uses find_one_and_update with a consumed=False filter so only the first
    concurrent request ever sees the challenge. The code is checked AFTER the
    consume, so a wrong code also consumes the challenge.

    Returns True when the code was valid (and the challenge was consumed).
    Returns False for every other outcome: no challenge, already consumed,
    expired, wrong code.
    """
    # Atomic: find one unconsumed challenge for this (market, email) and mark
    # it consumed. Only the first request that gets here succeeds at the find.
    challenge = challenges_collection.find_one_and_update(
        {
            MARKET_ID_FIELD: market_id,
            EMAIL_FIELD: email,
            CONSUMED_FIELD: False,
        },
        {"$set": {CONSUMED_FIELD: True}},
    )

    if challenge is None:
        # No unconsumed challenge exists. Don't distinguish "no challenge at
        # all" from "already consumed" - both return the same failure.
        return False

    # Check expiry. MongoDB returns datetime objects from the TTL-indexed field,
    # so compare directly. Do NOT distinguish "expired" from "wrong code" - both
    # return the same failure.
    expires_at = challenge.get(EXPIRES_AT_FIELD)
    if expires_at is None:
        return False
    if not isinstance(expires_at, datetime):
        return False
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) >= expires_at:
        return False

    # Constant-time code comparison. The consumed flag is already set, so a
    # wrong code here still consumes the challenge.
    stored_hash = challenge.get("code_hash", "")
    return _verify_code(stored_hash, candidate_code)


# ── Public endpoint handlers ──────────────────────────────────────────────

def request_login_code(market_slug: str) -> tuple:
    """Handle POST /public/markets/<slug>/applicant-login/request-code.

    Always returns the same 200 response regardless of whether the email is
    known to this market, and whether its email was sent. A challenge is created,
    and its code sent, for every address, before the response returns - unless the
    caller or the address is past its rate limit, which answers 429 and sends nothing.
    """
    email = _email_from(request.get_json(silent=True))
    refused = _refusal(sign_in_limits.REQUEST_CODE_PER_CALLER,
                       sign_in_limits.REQUEST_CODE_PER_ADDRESS, email)
    if refused:
        return refused
    if not email:
        return jsonify(_REQUEST_CODE_BODY), _REQUEST_CODE_STATUS

    # Resolve the slug to a market. If the market does not exist, return the
    # same response - the caller cannot distinguish "no such market" from
    # "no such application."
    market_doc = applicant_intake_market_by_slug(
        db["markets"],
        market_slug,
        fields=("id", "name"),
    )
    if market_doc is None:
        return jsonify(_REQUEST_CODE_BODY), _REQUEST_CODE_STATUS

    market_id = market_doc.get("id", "")
    market_name = market_doc.get("name", "this market")

    # Generate a code and store a challenge for EVERY address that requests
    # one. The existence of the challenge leaks nothing because it is created
    # for both applicants and non-applicants alike.
    code = _generate_code()
    expires_at = _code_expiry()
    _store_challenge(market_id, email, code, expires_at)

    # Every address is sent its code, applicant or not (E26/F07/S01). Codes went only to addresses
    # with an application, and nothing creates a first application before sign-in, so a vendor
    # who had never applied could never sign in to apply (bug 6). Sending to all is also the
    # strongest form of the ruling: the work is now identical for every address, not merely the
    # response. This endpoint still creates no Application document - the first save does, and
    # with it the D9 lock, exactly as specified.
    #
    # Sent before the response, not from a thread after it (E32/F03/S02). On serverless hosting a
    # process may be frozen the moment its response is out, and no code sent that way was ever seen
    # to arrive. The thread closed a timing oracle between applicants and strangers that sending to
    # every address has already closed. A failed send is logged and answered as a sent one.
    try:
        delivered = _send_code_email(email, code, market_name, market_slug)
    except Exception:
        logger.exception("Applicant sign-in code for market %s could not be sent", market_slug)
    else:
        if not delivered:
            logger.error("Applicant sign-in code for market %s was not sent", market_slug)

    return jsonify(_REQUEST_CODE_BODY), _REQUEST_CODE_STATUS


def verify_login_code(market_slug: str) -> tuple:
    """Handle POST /public/markets/<slug>/applicant-login/verify-code.

    All failure paths collapse to an identical 401 response. The caller cannot
    distinguish "no such address", "no code requested", "code expired",
    "code already used", or "wrong code" - one response for all.

    On success, returns the market ID and applicant email so the front end
    can proceed with authenticated applicant operations. Past the caller's or the
    address's rate limit it answers 429 and consumes nothing.
    """
    data = request.get_json(silent=True)
    email = _email_from(data)
    refused = _refusal(sign_in_limits.VERIFY_CODE_PER_CALLER,
                       sign_in_limits.VERIFY_CODE_PER_ADDRESS, email)
    if refused:
        return refused

    code = (data.get("code") or "").strip() if isinstance(data, dict) else ""

    if not email or not code:
        return jsonify(_VERIFY_FAILURE_BODY), _VERIFY_FAILURE_STATUS

    # Resolve the slug. Unknown market → same failure response.
    market_doc = applicant_intake_market_by_slug(
        db["markets"],
        market_slug,
        fields=("id",),
    )
    if market_doc is None:
        return jsonify(_VERIFY_FAILURE_BODY), _VERIFY_FAILURE_STATUS

    market_id = market_doc.get("id", "")
    if not market_id:
        return jsonify(_VERIFY_FAILURE_BODY), _VERIFY_FAILURE_STATUS

    # Consume and verify. All failure branches inside this function return the
    # same observable outcome.
    if _consume_and_verify(market_id, email, code):
        # A token for whoever proved the address, applied or not (E26/F07/S01). It used to be
        # issued only when an application existed, so a new vendor holding a good code got a 200
        # with no token and was sent back to "Sign In" without a word (bug 6). Telling the person
        # who just read the code whether they have applied leaks nothing; the ruling is about
        # strangers, and every failure below still collapses to one response.
        return jsonify({
            "success": True,
            "marketId": market_id,
            "applicantEmail": email,
            "token": generate_application_token(market_id, email),
        }), 200

    return jsonify(_VERIFY_FAILURE_BODY), _VERIFY_FAILURE_STATUS


def delete_challenges_for_market(market_id: str) -> int:
    """Take a market's outstanding sign-in codes with the market (``market_deletion``)."""
    return challenges_collection.delete_many({MARKET_ID_FIELD: market_id}).deleted_count
