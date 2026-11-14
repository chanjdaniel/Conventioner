"""An organizer's sign-ins, kept on the server (ADR 0028): the single owner of ``organizer_sessions``.

Every sign-in, by password or by code, is one document here. The browser holds a random secret, in
the session and, with "Remember me", in the ``__Host-organizer_remember`` cookie (``app.py``); the
server keeps only the secret's SHA-256, as the document's ``_id``, beside the account's id, the
login id it signed in under, whether it was remembered, and when it was made and ends. So a copy of
the database signs nobody in, and a sign-in can be ended on the server: once its document is gone,
a copy of the browser's cookies loads no account.

**What ends one.** Sign out ends the browser's own; a new sign-in in the same browser ends the one it
held before; a password reset, Sign out everywhere and deleting the account end every one of the
account's (``end_all``). The user loader also loads the account by the document's login id, so the
one write that replaces the login id ends every sign-in at once, and ``end_all`` clears what is left.
A TTL index removes a document once it has ended, and ``recall`` refuses one past its end whether or
not the TTL has run.

**Use never extends one.** ``recall`` reads without a write, so a sign-in ends when it was made to.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from pymongo.errors import PyMongoError

from db_config import get_database

SESSIONS_COLLECTION = "organizer_sessions"
USER_ID_FIELD = "user_id"
LOGIN_ID_FIELD = "login_id"
REMEMBERED_FIELD = "remembered"
CREATED_AT_FIELD = "created_at"
EXPIRES_AT_FIELD = "expires_at"

#: The indexes the boot builds (``ensure_organizer_session_indexes``), by name.
EXPIRY_INDEX = "organizer_session_ttl"
USER_INDEX = "organizer_session_user"

#: How many random bytes a secret holds.
SECRET_BYTES = 32

#: How long a sign-in without "Remember me" lasts, from signing in (E38/F14/S01): a market day. Its
#: session cookie ends with the browser, and the server ends it this long after signing in, since a
#: browser that restores its tabs restores its session cookies too.
SIGN_IN_LIFETIME = timedelta(hours=12)

#: How long a sign-in with "Remember me" lasts, from signing in: use does not extend it, so a lost
#: laptop is signed out within a month. The remember cookie expires then, and the server ends it
#: then too, whatever the browser kept.
REMEMBERED_SIGN_IN_LIFETIME = timedelta(days=30)

db = get_database()
sessions_collection = db[SESSIONS_COLLECTION]


class OrganizerSessionIndexError(RuntimeError):
    """The sign-ins cannot be indexed, so the process refuses to boot."""


def now() -> datetime:
    """The current time, in UTC; a function so a test can move the clock."""
    return datetime.now(timezone.utc)


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def lifetime(remembered: bool) -> timedelta:
    """How long a sign-in of this kind lasts, from signing in."""
    return REMEMBERED_SIGN_IN_LIFETIME if remembered else SIGN_IN_LIFETIME


def start(user_id: str, login_id: str, remembered: bool) -> str:
    """Start a sign-in of the account under its login id; the secret for the browser to hold.

    The secret is never stored: the document holds its hash.
    """
    at = now()
    secret = secrets.token_urlsafe(SECRET_BYTES)
    sessions_collection.insert_one({
        "_id": _hash(secret),
        USER_ID_FIELD: user_id,
        LOGIN_ID_FIELD: login_id,
        REMEMBERED_FIELD: bool(remembered),
        CREATED_AT_FIELD: at,
        EXPIRES_AT_FIELD: at + lifetime(remembered),
    })
    return secret


def recall(secret: str) -> Optional[Tuple[str, str]]:
    """``(user id, login id)`` of the live sign-in a secret names, or None.

    Read without a write, so use never moves when it ends.
    """
    if not isinstance(secret, str) or not secret:
        return None
    doc = sessions_collection.find_one({"_id": _hash(secret), EXPIRES_AT_FIELD: {"$gt": now()}})
    if doc is None:
        return None
    return doc.get(USER_ID_FIELD), doc.get(LOGIN_ID_FIELD)


def end(secret: Optional[str]) -> None:
    """End the sign-in a secret names, whether or not there is one."""
    if isinstance(secret, str) and secret:
        sessions_collection.delete_one({"_id": _hash(secret)})


def end_all(user_id: Optional[str]) -> int:
    """End every sign-in of the account; how many there were."""
    if not user_id:
        return 0
    return sessions_collection.delete_many({USER_ID_FIELD: user_id}).deleted_count


def ensure_organizer_session_indexes() -> None:
    """Build the TTL index that removes a sign-in once it has ended, and the index ``end_all``
    reads by.

    Raises ``OrganizerSessionIndexError`` when it cannot; ``app.py``'s boot refuses to start on it.
    """
    try:
        sessions_collection.create_index(
            [(EXPIRES_AT_FIELD, 1)], expireAfterSeconds=0, name=EXPIRY_INDEX,
        )
        sessions_collection.create_index([(USER_ID_FIELD, 1)], name=USER_INDEX)
    except PyMongoError as exc:
        # The driver's message is not repeated, nor kept as the cause, as the other boot checks do.
        raise OrganizerSessionIndexError(
            f"Could not build the indexes on {SESSIONS_COLLECTION} ({type(exc).__name__}, code "
            f"{getattr(exc, 'code', None)}): without them an ended sign-in is never removed and "
            f"Sign out everywhere scans every sign-in."
        ) from None
