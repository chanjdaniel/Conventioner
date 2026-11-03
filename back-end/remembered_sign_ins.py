"""Remember me on a vendor page (ADR 0022): the single owner of ``vendor_remembered_sign_ins``.

A vendor who ticks "Remember me on this device" when they enter their code stays signed in to that
market's page on that device until the market's last date has ended, and never longer than
``REMEMBER_AT_MOST`` from the sign-in; use never extends it.

**The device holds a secret; the server holds its hash.** The secret is 32 random bytes in a
cookie, ``vendor_remember_<market id>``, which is ``Secure``, ``SameSite=None`` and ``HttpOnly``
(set in ``app.py``'s cookie settings block), so no script on the page reads it. The server keeps a
document whose ``_id`` is the secret's SHA-256, with the market, the address, when it ends and when
it was made, so a leaked backup signs nobody in. A cookie names one market, so remembering a vendor
at one market changes nothing at another.

**It ends for good.** Sign out deletes the document, so a copy of the cookie stops working; a
cookie refused for any reason is forgotten the same way; deleting the market deletes its documents
(``market_deletion``); and a TTL index removes a document once it has ended, built by the applicant
login boot check, which refuses to start without it.
"""
import hashlib
import secrets
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Iterable, Optional, Tuple

from flask import current_app, request

from db_config import get_database

REMEMBERED_SIGN_INS_COLLECTION = "vendor_remembered_sign_ins"
MARKET_ID_FIELD = "market_id"
EMAIL_FIELD = "email"
EXPIRES_AT_FIELD = "expires_at"
CREATED_AT_FIELD = "created_at"

#: How many random bytes a secret holds.
SECRET_BYTES = 32

db = get_database()
remembered_collection = db[REMEMBERED_SIGN_INS_COLLECTION]

#: The longest a remembered sign-in lasts, whatever the market's dates.
REMEMBER_AT_MOST = timedelta(days=120)

#: When the market's last date has ended in every time zone: noon UTC on the day after it.
_LAST_DATE_ENDS_AT = time(12, 0, tzinfo=timezone.utc)


def now() -> datetime:
    """The current time, in UTC; a function so a test can move the clock."""
    return datetime.now(timezone.utc)


def _last_date_end(market_dates: Iterable[str]) -> Optional[datetime]:
    days = []
    for value in market_dates:
        try:
            days.append(date.fromisoformat(str(value)[:10]))
        except ValueError:
            continue
    if not days:
        return None
    return datetime.combine(max(days) + timedelta(days=1), _LAST_DATE_ENDS_AT)


def remembered_until(market_dates: Iterable[str], at: datetime) -> Optional[datetime]:
    """When a sign-in remembered at ``at`` would end, or ``None`` when the market has no date left.

    The earlier of the end of the market's last date and ``REMEMBER_AT_MOST`` after ``at``.
    """
    last_date_end = _last_date_end(market_dates)
    if last_date_end is None or last_date_end <= at:
        return None
    return min(last_date_end, at + REMEMBER_AT_MOST)


def remembered_until_date(market_dates: Iterable[str], at: datetime) -> Optional[str]:
    """The date a vendor reads beside "Remember me", as ``YYYY-MM-DD``, or ``None``.

    The market's last date when that is what ends it, rather than the noon after it that does,
    else the date ``REMEMBER_AT_MOST`` on.
    """
    dates = list(market_dates)
    until = remembered_until(dates, at)
    if until is None:
        return None
    if until == _last_date_end(dates):
        return (until - timedelta(days=1)).date().isoformat()
    return until.date().isoformat()


# ── The cookie ───────────────────────────────────────────────────────────

def cookie_name(market_id: str) -> str:
    """The cookie a market's remembered sign-in is kept in: one per market, so one per page."""
    return f"vendor_remember_{market_id}"


def _cookie_settings() -> dict:
    """The cookie's ``Secure``, ``HttpOnly`` and ``SameSite``, from ``app.py``'s settings block."""
    config = current_app.config
    return {
        "secure": config["VENDOR_REMEMBER_COOKIE_SECURE"],
        "httponly": config["VENDOR_REMEMBER_COOKIE_HTTPONLY"],
        "samesite": config["VENDOR_REMEMBER_COOKIE_SAMESITE"],
    }


def held_secret(market_id: str) -> Optional[str]:
    """The secret this request's browser holds for the market, or ``None``."""
    return request.cookies.get(cookie_name(market_id)) or None


def set_cookie(response: Any, market_id: str, secret: str, expires_at: datetime) -> None:
    """Give the browser the secret, to keep until the sign-in ends and no longer."""
    response.set_cookie(
        cookie_name(market_id), secret, expires=expires_at, path="/", **_cookie_settings(),
    )


def clear_cookie(response: Any, market_id: str) -> None:
    """Tell the browser to drop the market's cookie, with the attributes it was set with."""
    response.set_cookie(cookie_name(market_id), "", expires=0, path="/", **_cookie_settings())


# ── The documents ────────────────────────────────────────────────────────

def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def remember(
    market_id: str, email: str, market_dates: Iterable[str],
) -> Optional[Tuple[str, datetime]]:
    """Remember the address at the market; ``(secret, expires_at)``, or ``None`` past its last date.

    The secret goes to the browser and is never stored; the document holds its hash.
    """
    at = now()
    expires_at = remembered_until(market_dates, at)
    if expires_at is None:
        return None
    secret = secrets.token_urlsafe(SECRET_BYTES)
    remembered_collection.insert_one({
        "_id": _hash(secret),
        MARKET_ID_FIELD: market_id,
        EMAIL_FIELD: email,
        EXPIRES_AT_FIELD: expires_at,
        CREATED_AT_FIELD: at,
    })
    return secret, expires_at


def recall(market_id: str, secret: str) -> Optional[str]:
    """The address a live secret remembers at this market, or ``None``.

    Read without a write, so use never moves when it ends.
    """
    doc = remembered_collection.find_one({
        "_id": _hash(secret),
        MARKET_ID_FIELD: market_id,
        EXPIRES_AT_FIELD: {"$gt": now()},
    })
    return None if doc is None else doc.get(EMAIL_FIELD)


def forget(market_id: str, secret: str) -> None:
    """End the sign-in a secret names at this market, whether or not there is one."""
    remembered_collection.delete_one({"_id": _hash(secret), MARKET_ID_FIELD: market_id})


def delete_for_market(market_id: str) -> int:
    """Take a market's remembered sign-ins with the market (``market_deletion``)."""
    return remembered_collection.delete_many({MARKET_ID_FIELD: market_id}).deleted_count


def ensure_expiry_index() -> None:
    """Build the TTL index that removes a remembered sign-in once it has ended.

    Raises ``PyMongoError`` when it cannot; the applicant login boot check
    (``api.applicant_auth.ensure_applicant_login_indexes``) refuses to start on it.
    """
    remembered_collection.create_index(
        [(EXPIRES_AT_FIELD, 1)],
        expireAfterSeconds=0,
        name="remembered_sign_in_ttl",
    )
