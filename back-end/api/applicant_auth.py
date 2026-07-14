"""Applicant email-code login - the security boundary between a public form and a
private applicant list.

Every endpoint in this module is unauthenticated. Every line is attacker-facing.
The design is the captain's ruling in full - see the decision file at
``/home/danielc/.firstmate/data/decision-applicant-login-oracle.md``. The key
constraints:

1. **No attempt counter anywhere.** A code is consumed by a single verification
   attempt, right or wrong. No per-address counter, no lockout, no "attempts
   remaining."

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
   path is measurably slower. The known-address branch does an extra email send;
   the unknown-address branch does nothing materially different but the response
   goes out as soon as the challenge is stored.
"""
import hashlib
import logging
import secrets
import threading
from datetime import datetime, timedelta, timezone

from flask import jsonify, request
from pymongo.errors import PyMongoError

from db_config import get_database
from market_documents import published_market_by_slug
from utils.email import _email_disabled, ready_mailer, from_email, frontend_url

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

    Two indexes:
    1. A unique compound index on ``(market_id, email)`` so an address has at
       most one active challenge per market - a new request overwrites the old one.
    2. A TTL index on ``expires_at`` so expired challenges are cleaned up by
       the database, not by application code.

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
    except PyMongoError as exc:
        message = (
            f"The indexes on {APPLICANT_LOGIN_CHALLENGES_COLLECTION} could not be "
            f"built, so nothing is enforcing one-code-one-attempt or cleaning up "
            f"expired challenges: {exc}"
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

_REQUEST_CODE_BODY = {"message": "If an account exists for this email, we've sent a code."}
_REQUEST_CODE_STATUS = 200

_VERIFY_FAILURE_BODY = {"message": "Invalid or expired code."}
_VERIFY_FAILURE_STATUS = 401


# ── Email sending ─────────────────────────────────────────────────────────

def _send_code_email(email: str, code: str, market_name: str, market_id: str) -> bool:
    """Send the login code to the applicant's email address.

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
    login_url = f"{base_url}/markets/{market_id}/login"

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Login Code</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="color: #4CAF50;">Your Login Code</h1>
        <p>You requested access to your application for <strong>{market_name}</strong>.</p>
        <div style="background-color: #f5f5f5; border: 2px dashed #4CAF50; padding: 20px; text-align: center; margin: 30px 0;">
            <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #4CAF50; margin: 0;">{code}</p>
        </div>
        <p>Enter this code on the login page to access your application.</p>
        <p style="color: #999; font-size: 12px; margin-top: 30px;">This code will expire in {CODE_EXPIRY_MINUTES} minutes and can only be used once.</p>
        <p style="color: #999; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
    </body>
    </html>
    """

    text_content = f"""
    Your Login Code

    You requested access to your application for "{market_name}".

    Your code: {code}

    Enter this code on the login page: {login_url}

    This code will expire in {CODE_EXPIRY_MINUTES} minutes and can only be used once.

    If you didn't request this code, please ignore this email.
    """

    try:
        response = resend.Emails.send({
            "from": from_email(),
            "to": [email],
            "subject": f"Your login code for {market_name}",
            "html": html_content,
            "text": text_content,
        })
        if response and hasattr(response, "id"):
            logger.info("Applicant login code sent to %s for market %s", email, market_id)
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
    known to this market. A challenge is created for every address. The email
    send is dispatched to a daemon thread so the response does not block on it,
    closing the timing oracle.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return jsonify(_REQUEST_CODE_BODY), _REQUEST_CODE_STATUS

    email = (data.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return jsonify(_REQUEST_CODE_BODY), _REQUEST_CODE_STATUS

    # Resolve the slug to a market. If the market does not exist, return the
    # same response - the caller cannot distinguish "no such market" from
    # "no such application."
    market_doc = published_market_by_slug(
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

    # Check whether this email actually has an application at this market.
    # Do NOT prevent the Application document from being created - the captain
    # has explicitly forbidden that. The D9 lock engages on the first
    # Application document, and this endpoint does not create one.
    apps_collection = db["applications"]
    has_application = apps_collection.find_one(
        {"market_id": market_id, "applicant_email": email}
    ) is not None

    # Only send the email when the address is actually an applicant.
    # The send is dispatched to a daemon thread so it does NOT block the
    # response. This closes the timing oracle: a real applicant and a stranger
    # get the same response latency regardless of whether an email goes out.
    if has_application:
        threading.Thread(
            target=_send_code_email,
            args=(email, code, market_name, market_id),
            daemon=True,
        ).start()

    return jsonify(_REQUEST_CODE_BODY), _REQUEST_CODE_STATUS


def verify_login_code(market_slug: str) -> tuple:
    """Handle POST /public/markets/<slug>/applicant-login/verify-code.

    All failure paths collapse to an identical 401 response. The caller cannot
    distinguish "no such address", "no code requested", "code expired",
    "code already used", or "wrong code" - one response for all.

    On success, returns the market ID and applicant email so the front end
    can proceed with authenticated applicant operations.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return jsonify(_VERIFY_FAILURE_BODY), _VERIFY_FAILURE_STATUS

    email = (data.get("email") or "").strip().lower()
    code = (data.get("code") or "").strip()

    if not email or not code:
        return jsonify(_VERIFY_FAILURE_BODY), _VERIFY_FAILURE_STATUS

    # Resolve the slug. Unknown market → same failure response.
    market_doc = published_market_by_slug(
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
        return jsonify({
            "success": True,
            "marketId": market_id,
            "applicantEmail": email,
        }), 200

    return jsonify(_VERIFY_FAILURE_BODY), _VERIFY_FAILURE_STATUS
