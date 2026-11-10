"""Applicant email-code login - the security boundary between a public form and a
private applicant list.

Every endpoint in this module is unauthenticated. Every line is attacker-facing.
The design is the captain's ruling in full - see the decision file at
``/home/danielc/.firstmate/data/decision-applicant-login-oracle.md``. The key
constraints:

1. **A code takes five tries, counted on the code, never on an application.**
   A code lasts ten minutes and takes ``MAX_CODE_ATTEMPTS`` tries; the fifth wrong
   one ends it (T202, superseding "one code, one attempt", which burnt a code on a
   slip while the page went on offering it). The count lives on the challenge,
   which every address that asks is given alike, so it says nothing of who applied:
   no "attempts remaining", and nothing counted only for addresses that applied,
   since such a counter answers whether they had. The rate limits
   (``sign_in_limits``) count every address and every caller alike, before the
   market is looked up, so their refusal leaks nothing, and they bound the guesses
   at a six-digit code to 10 per address per 15 minutes.

2. **Requesting a code is indistinguishable, always.** Same HTTP status, shape
   and body whether or not the address is known.

3. **Verifying a code tells nothing about who applied.** Every way a code cannot
   pass (unknown address, no code issued, expired, already consumed, the fifth wrong
   try, a gated or unknown market) collapses to one observable response, "spent".
   The one other refusal, "retry", is a wrong try on a live code: it says only that
   someone asked for a code for this address in the last ten minutes, which anyone
   can make true by asking, so it says nothing of whether the address applied.

4. **Enforced on the back end.** The front end is 5e; this must stand alone.

5. **The login challenge lives in its own collection** keyed by ``(market_id, email)``,
   created for any address that requests a code - applicant or not. The
   ``Application`` document keeps engaging the D9 hard lock exactly as the
   captain specified.

6. **Timing is also a channel.** Identical response bodies are worthless if one
   path is measurably slower. Every address is sent its code (E26/F07/S01), so the
   work is the same for all, and the send runs on a thread so the response goes out
   as soon as the challenge is stored.

7. **Remember me spares the code, never the proof.** A right code with ``remember``
   ticked also gives the browser a remembered sign-in (``remembered_sign_ins``): an
   HttpOnly cookie holding a secret the server keeps only as a hash. ``resume``
   answers for a live one exactly as a right code does, and every way one cannot
   pass (none, tampered, ended, signed out, another market's, a gated market) is one
   401, which also forgets and clears a cookie the browser sent. It is counted per
   caller before the cookie is read.

A first-time vendor signs in exactly as a returning one does: the token names the
address and the market, not an application, and their first save creates it.
"""
import hashlib
import html
import logging
import secrets
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

from flask import current_app, jsonify, request
from pymongo import ReturnDocument
from pymongo.errors import PyMongoError

import remembered_sign_ins as RememberedSignIns
import sign_in_limits
from client_errors import traceback_without_messages
from db_config import get_database
from market_documents import market_dates_of, market_id_at_slug, vendor_page_market_by_slug
from utils.email import frontend_url, one_line, send_mail
from utils.application_token import generate_application_token
from utils.email_address import normalized_email
from utils.request_body import string_field

logger = logging.getLogger(__name__)

# ── Collection setup ──────────────────────────────────────────────────────

APPLICANT_LOGIN_CHALLENGES_COLLECTION = "applicant_login_challenges"
MARKET_ID_FIELD = "market_id"
EMAIL_FIELD = "email"
CONSUMED_FIELD = "consumed"
EXPIRES_AT_FIELD = "expires_at"
# Wrong and right tries at the current code so far; a new code starts it at 0.
ATTEMPTS_FIELD = "attempts"
# How many codes this address has asked for at this market; numbers each email's subject.
SEQUENCE_FIELD = "sequence"

db = get_database()
challenges_collection = db[APPLICANT_LOGIN_CHALLENGES_COLLECTION]

_indexes_ready = False


class ApplicantLoginIndexError(RuntimeError):
    """The indexes that keep one live code per address are not in place."""


def ensure_applicant_login_indexes() -> None:
    """Build the indexes the applicant login endpoints rest on.

    Four indexes:
    1. A unique compound index on ``(market_id, email)`` so an address has at
       most one active challenge per market - a new request overwrites the old one.
    2. A TTL index on ``expires_at`` so expired challenges are cleaned up by
       the database, not by application code.
    3. The TTL index that expires the sign-in rate limit counters
       (``sign_in_limits``), without which they would pile up for ever.
    4. The TTL index that removes a vendor's remembered sign-in once it has ended
       (``remembered_sign_ins``).

    A build that fails raises, and the caller fails with it. This index is not
    a decoration; it is the guarantee that an address has one challenge, so the
    conditional updates that count its tries and mark it used act on the one
    code it was sent, and that a process serving on without it is silently
    allowing a code to be tried and replayed beyond its bounds.
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
        RememberedSignIns.ensure_expiry_index()
    except PyMongoError as exc:
        # The driver's message is not repeated, nor kept as the cause: a duplicate key error on
        # the challenges quotes the vendor's address.
        message = (
            f"The indexes on {APPLICANT_LOGIN_CHALLENGES_COLLECTION}, "
            f"{sign_in_limits.SIGN_IN_ATTEMPTS_COLLECTION} and "
            f"{RememberedSignIns.REMEMBERED_SIGN_INS_COLLECTION} could not be built "
            f"({type(exc).__name__}, code {getattr(exc, 'code', None)}), so nothing is keeping "
            f"one code per address or cleaning up expired challenges, rate limit counters and "
            f"remembered sign-ins. Duplicate challenges, which a duplicate key error means, can be "
            f"deleted: each expires within {CODE_EXPIRY_MINUTES} minutes anyway."
        )
        logger.critical("%s", message)
        raise ApplicantLoginIndexError(message) from None
    _indexes_ready = True


# ── Code generation and verification ──────────────────────────────────────

CODE_LENGTH = 6
CODE_EXPIRY_MINUTES = 10
MAX_CODE_ATTEMPTS = 5


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

_VERIFY_FAILURE_STATUS = 401
# A wrong try on a live code with tries left. The page clears the field for another.
_RETRY_BODY = {
    "message": "That code isn't right. Check you typed the newest code and try again.",
    "codeState": "retry",
}
# Every other way a code cannot pass, one body for all; the page offers only "Send a new code".
_SPENT_BODY = {
    "message": "That code no longer works. Send yourself a new code.",
    "codeState": "spent",
}

# Every way a remembered sign-in cannot pass, one body for all; the page then asks for a code.
_RESUME_FAILURE_BODY = {"message": "Sign in with a code."}


# ── Rate limits ──────────────────────────────────────────────────────────

def _caller_refusal(limit: sign_in_limits.SignInLimit):
    """A 429 when this caller is past its limit; None otherwise.

    Asked on every request before the body or the slug is read, so the caller is counted alike
    whatever it sends, and a refusal is the same for every address and every market, real or not.
    """
    return _too_many(sign_in_limits.count_attempt(limit, sign_in_limits.caller()))


def _address_refusal(limit: sign_in_limits.SignInLimit, email: Optional[str]):
    """A 429 when this address is past its limit; None otherwise, and for a request naming none.

    Asked only once the caller is within its limit.
    """
    if not email:
        return None
    return _too_many(sign_in_limits.count_attempt(limit, email))


def _too_many(retry_after: Optional[int]):
    """The sign-in's refusal for a limit that says to wait, or None (``sign_in_limits.too_many``)."""
    return sign_in_limits.too_many(
        retry_after, "Too many sign-in attempts. Please try again in {wait}.")


def _email_from(data) -> Optional[str]:
    """The normalised address a request names, or None when it names none."""
    email = normalized_email(string_field(data, "email"))
    return email if email and "@" in email else None


# ── Email sending ─────────────────────────────────────────────────────────

def _send_code_email(
    email: str, code: str, market_name: str, market_slug: str, sequence: int
) -> bool:
    """Send the sign-in code to the vendor's email address, through ``send_mail``.

    It links to the market's own vendor page, ``/<slug>``, by its public address: the link a vendor
    receives is the one they keep (ADR 0022). Its subject carries the code's number, ``sequence``,
    and never the code: a mail client threads emails by subject, and with one subject for all it
    buried the newest code under an older one, which a vendor then typed (T191 F22).

    The market's name is the one value here someone else typed: anyone can name a market and ask
    for a code to any address. So the HTML holds it escaped wherever it appears, and the subject and
    text hold it on one line, and a name holding a link or a header line reaches the inbox as words.

    Returns True when the email was accepted by the provider (or disabled in dev),
    False when it was not.
    """
    page_url = f"{frontend_url()}/{market_slug}"
    name_in_html = html.escape(market_name, quote=True)
    name_in_words = one_line(market_name)

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
        <p>You asked to sign in to your page for <strong>{name_in_html}</strong>.</p>
        <div style="background-color: #f5f5f5; border: 2px dashed #36826f; padding: 20px; text-align: center; margin: 30px 0;">
            <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #36826f; margin: 0;">{code}</p>
        </div>
        <p>Enter it on <a href="{page_url}">your page for {name_in_html}</a>.</p>
        <p style="color: #777474; font-size: 12px; margin-top: 30px;">This code expires in {CODE_EXPIRY_MINUTES} minutes. Only the newest code works.</p>
        <p style="color: #777474; font-size: 12px;">If you didn't request this code, please ignore this email.</p>
    </body>
    </html>
    """

    text_content = f"""
    Your sign-in code

    You asked to sign in to your page for "{name_in_words}".

    Your code: {code}

    Enter it on your page for {name_in_words}: {page_url}

    This code expires in {CODE_EXPIRY_MINUTES} minutes. Only the newest code works.

    If you didn't request this code, please ignore this email.
    """

    return send_mail(
        "applicant sign-in code",
        email,
        f"Your sign-in code for {name_in_words} (#{sequence})",
        html_content,
        text_content,
    )


# ── Challenge storage ─────────────────────────────────────────────────────

def _store_challenge(market_id: str, email: str, code: str, expires_at: datetime) -> int:
    """Store (or overwrite) a login challenge for (market_id, email); return the code's number.

    The unique index on (market_id, email) means a new request overwrites any
    existing challenge - one code per address per market, its tries counted
    afresh. The previous code is dead after this overwrite. ``sequence`` counts
    the codes this address has asked for here while a challenge stands, and
    numbers the email's subject; it starts again once the TTL index removes an
    expired challenge.
    """
    challenge = challenges_collection.find_one_and_update(
        {MARKET_ID_FIELD: market_id, EMAIL_FIELD: email},
        {
            "$set": {
                "code_hash": _hash_code(code),
                EXPIRES_AT_FIELD: expires_at,
                CONSUMED_FIELD: False,
                ATTEMPTS_FIELD: 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            "$inc": {SEQUENCE_FIELD: 1},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return challenge[SEQUENCE_FIELD]


def _spend_unsent_challenge(market_id: str, email: str, sequence: int) -> None:
    """Mark the challenge this request stored consumed, because its code was never sent.

    Filtered on the sequence the request was numbered, so a newer code another request stored
    meanwhile (a higher sequence) is left armed.
    """
    challenges_collection.update_one(
        {MARKET_ID_FIELD: market_id, EMAIL_FIELD: email, SEQUENCE_FIELD: sequence},
        {"$set": {CONSUMED_FIELD: True}},
    )


class _Verified(Enum):
    """What a try at a code came to."""

    SIGNED_IN = "signed_in"
    RETRY = "retry"
    SPENT = "spent"


def _try_code(market_id: str, email: str, candidate_code: str) -> _Verified:
    """Count a try at the address's code, then compare it; at most one right try signs in.

    The try is counted by one atomic update that matches only a live challenge: unconsumed,
    unexpired and with tries left. No match is "spent", whichever of those it was, and a code
    never issued answers the same. The code is then compared in constant time. A right code
    marks the challenge consumed with a write conditional on it still being unconsumed and still
    the same code, so of two right tries at once only one signs in; the fifth wrong try marks it
    consumed too.
    """
    challenge = challenges_collection.find_one_and_update(
        {
            MARKET_ID_FIELD: market_id,
            EMAIL_FIELD: email,
            CONSUMED_FIELD: False,
            EXPIRES_AT_FIELD: {"$gt": datetime.now(timezone.utc)},
            ATTEMPTS_FIELD: {"$lt": MAX_CODE_ATTEMPTS},
        },
        {"$inc": {ATTEMPTS_FIELD: 1}},
        return_document=ReturnDocument.AFTER,
    )
    if challenge is None:
        return _Verified.SPENT

    stored_hash = challenge.get("code_hash", "")
    # Only this code's challenge, unconsumed: a new request between the count and here made a new
    # code, which this try does not touch.
    this_code_unconsumed = {
        MARKET_ID_FIELD: market_id,
        EMAIL_FIELD: email,
        "code_hash": stored_hash,
        CONSUMED_FIELD: False,
    }
    if _verify_code(stored_hash, candidate_code):
        won = challenges_collection.update_one(
            this_code_unconsumed, {"$set": {CONSUMED_FIELD: True}}
        )
        return _Verified.SIGNED_IN if won.modified_count == 1 else _Verified.SPENT

    if challenge.get(ATTEMPTS_FIELD, MAX_CODE_ATTEMPTS) >= MAX_CODE_ATTEMPTS:
        challenges_collection.update_one(this_code_unconsumed, {"$set": {CONSUMED_FIELD: True}})
        return _Verified.SPENT
    return _Verified.RETRY


# ── Public endpoint handlers ──────────────────────────────────────────────

def request_login_code(market_slug: str) -> tuple:
    """Handle POST /public/markets/<slug>/applicant-login/request-code.

    Always returns the same 200 response regardless of whether the email is
    known to this market, and whether its email was sent. A challenge is created,
    and its code sent, for every address, before the response returns - unless the
    caller or the address is past its rate limit, which answers 429 and sends nothing.
    """
    refused = _caller_refusal(sign_in_limits.REQUEST_CODE_PER_CALLER)
    if refused:
        return refused
    email = _email_from(request.get_json(silent=True))
    refused = _address_refusal(sign_in_limits.REQUEST_CODE_PER_ADDRESS, email)
    if refused:
        return refused
    if not email:
        return jsonify(_REQUEST_CODE_BODY), _REQUEST_CODE_STATUS

    # Resolve the slug to a market. If the market does not exist, return the
    # same response - the caller cannot distinguish "no such market" from
    # "no such application."
    market_doc = vendor_page_market_by_slug(
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
    sequence = _store_challenge(market_id, email, code, expires_at)

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
        delivered = _send_code_email(email, code, market_name, market_slug, sequence)
    except Exception as error:
        # By its type and frames: a mail library's message can quote the address it was given.
        logger.error(
            "Applicant sign-in code for market %s could not be sent\n%s",
            market_slug, traceback_without_messages(error),
        )
        delivered = False
    else:
        if not delivered:
            logger.error("Applicant sign-in code for market %s was not sent", market_slug)
    if not delivered:
        # A code nobody received is not left armed: the address may ask for another at once.
        _spend_unsent_challenge(market_id, email, sequence)

    return jsonify(_REQUEST_CODE_BODY), _REQUEST_CODE_STATUS


def verify_login_code(market_slug: str) -> tuple:
    """Handle POST /public/markets/<slug>/applicant-login/verify-code.

    A wrong try at a live code with tries left answers 401 "retry"; every other
    failure answers one identical 401 "spent": the fifth wrong try, "code expired",
    "code already used", "no code requested", "no such address", a missing address
    or code, and a gated or unknown market. Neither says whether the address applied.

    On success, returns the market ID and applicant email so the front end
    can proceed with authenticated applicant operations. Past the caller's or the
    address's rate limit it answers 429 and counts no try.
    """
    refused = _caller_refusal(sign_in_limits.VERIFY_CODE_PER_CALLER)
    if refused:
        return refused
    data = request.get_json(silent=True)
    email = _email_from(data)
    refused = _address_refusal(sign_in_limits.VERIFY_CODE_PER_ADDRESS, email)
    if refused:
        return refused

    code = (string_field(data, "code") or "").strip()

    if not email or not code:
        return jsonify(_SPENT_BODY), _VERIFY_FAILURE_STATUS

    # Resolve the slug. Unknown market → same failure response.
    market_doc = vendor_page_market_by_slug(
        db["markets"],
        market_slug,
        fields=("id", "setupObject"),
    )
    if market_doc is None:
        return jsonify(_SPENT_BODY), _VERIFY_FAILURE_STATUS

    market_id = market_doc.get("id", "")
    if not market_id:
        return jsonify(_SPENT_BODY), _VERIFY_FAILURE_STATUS

    verified = _try_code(market_id, email, code)
    if verified is _Verified.SIGNED_IN:
        # A token for whoever proved the address, applied or not (E26/F07/S01). It used to be
        # issued only when an application existed, so a new vendor holding a good code got a 200
        # with no token and was sent back to "Sign In" without a word (bug 6). Telling the person
        # who just read the code whether they have applied leaks nothing; the ruling is about
        # strangers, and no failure says it.
        response = _signed_in(market_id, email)
        _remember_on_this_device(
            response, market_id, email, market_dates_of(market_doc),
            remember=isinstance(data, dict) and data.get("remember") is True,
        )
        return response, 200
    if verified is _Verified.RETRY:
        return jsonify(_RETRY_BODY), _VERIFY_FAILURE_STATUS
    return jsonify(_SPENT_BODY), _VERIFY_FAILURE_STATUS


def _signed_in(market_id: str, email: str):
    """The answer to a right code, and to a live remembered sign-in: a 30-minute token."""
    return jsonify({
        "success": True,
        "marketId": market_id,
        "applicantEmail": email,
        "token": generate_application_token(market_id, email),
    })


def _remember_on_this_device(response, market_id: str, email: str, market_dates, remember: bool):
    """After a right code: remember this address on this device when ticked, and no one else.

    A sign-in ends the remembered one the browser held for this market, whoever it named, so a
    shared device left unticked remembers nobody, as an organizer's sign-in clears theirs. A market
    whose last date has ended remembers nothing; the page offers no "Remember me" then.
    """
    held = RememberedSignIns.held_secret(market_id)
    if held:
        RememberedSignIns.forget(market_id, held)
    made = RememberedSignIns.remember(market_id, email, market_dates) if remember else None
    if made:
        secret, expires_at = made
        RememberedSignIns.set_cookie(response, market_id, secret, expires_at)
    elif held:
        RememberedSignIns.clear_cookie(response, market_id)


def resume_sign_in(market_slug: str) -> tuple:
    """Handle POST /public/markets/<slug>/applicant-login/resume.

    A browser holding a live remembered sign-in for this market is answered exactly as a right
    code is. Every way it cannot pass - no cookie, a tampered or ended one, one signed out, another
    market's secret under this market's name, a market the vendor page gate no longer serves, a
    slug naming nothing - answers one identical 401; a cookie the browser sent is forgotten on the
    server and cleared, so it is refused for good. Never written on success, so use never moves
    when it ends. Counted against the caller before the cookie is read.
    """
    refused = _caller_refusal(sign_in_limits.RESUME_PER_CALLER)
    if refused:
        return refused

    market_doc = vendor_page_market_by_slug(db["markets"], market_slug, fields=("id",))
    market_id = (market_doc or {}).get("id") or market_id_at_slug(db["markets"], market_slug)
    secret = RememberedSignIns.held_secret(market_id) if market_id else None
    email = RememberedSignIns.recall(market_id, secret) if market_doc and secret else None
    if email:
        return _signed_in(market_id, email), 200

    response = jsonify(_RESUME_FAILURE_BODY)
    if secret:
        RememberedSignIns.forget(market_id, secret)
        RememberedSignIns.clear_cookie(response, market_id)
    return response, _VERIFY_FAILURE_STATUS


def sign_out(market_slug: str) -> tuple:
    """Handle POST /public/markets/<slug>/applicant-login/sign-out.

    Ends the remembered sign-in the browser holds for this market, on the server and in the
    browser, so a copy of the cookie stops working too. 204 whether or not there was one, and for a
    market the gate no longer serves, whose cookie the browser may still hold.
    """
    market_id = market_id_at_slug(db["markets"], market_slug)
    secret = RememberedSignIns.held_secret(market_id) if market_id else None
    response = current_app.response_class(status=204)
    if secret:
        RememberedSignIns.forget(market_id, secret)
        RememberedSignIns.clear_cookie(response, market_id)
    return response, 204


def delete_challenges_for_market(market_id: str) -> int:
    """Take a market's outstanding sign-in codes with the market (``market_deletion``)."""
    return challenges_collection.delete_many({MARKET_ID_FIELD: market_id}).deleted_count
