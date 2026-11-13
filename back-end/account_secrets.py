"""An account's sign-in secrets (ADR 0026): the only code that reads or writes them.

An organizer's account holds up to three secrets a mail carries: a sign-in code, a reset link and a
verification link. Each is one record under the account's ``secrets`` field, by kind
(``secrets.code``, ...), shaped ``{hash, expires_at, next_allowed_at, tries, state}``:

- ``hash`` is what the server keeps of the secret, never the secret itself, so a copy of the
  database holds nothing that signs an account in. A code is kept salted (``hash_code``), as the
  vendor's code is, and checked against a try in constant time (``code_matches``). A link is kept
  as its SHA-256, unsalted (``hash_link``), so the account a link names is found by its hash; a
  link is 192 random bits, so its hash reveals nothing of it.
- ``expires_at`` and ``next_allowed_at`` are UTC datetimes; ``next_allowed_at`` is null when
  there is no wait before the next secret of the kind may be mailed.
- ``tries`` counts the tries that reached a code.
- ``state`` is one of ``sending`` (issued, its mail not yet answered), ``live`` (mailed),
  ``used`` and ``discarded``; an absent record is the state "none".

Every change is one write conditional on the state it moves from, so two requests at once meet in
the filter and one of them wins; nothing else writes the field (a source scan in the tests holds
that). The functions take the users collection as their first argument, which ``api/users.py``
passes, and read the time from ``now()``, which tests move.

The kinds, and how each lives (``KINDS``):

| Kind | Mailed as | Life | ``next_allowed_at`` once mailed | Tries |
| --- | --- | --- | --- | --- |
| ``code`` | 6 digits (``generate_otp``) | 5 minutes | ``expires_at`` + 1 hour | 5 |
| ``reset`` | ``token_urlsafe(24)`` (``generate_reset_token``) | 1 hour | ``expires_at`` + 1 hour | not counted |

A password reset by the mailed link (``use_reset_link``) is one write that sets the password, uses
the link, ends every other secret the module keeps, marks the address verified and replaces the
login id, so a code from before the reset no longer signs in and every sign-in issued before ends.

For one release the fields an account held its secrets in before this module (``otp``,
``otp_expires``, ``otp_attempts``; ``password_reset_token``, ``password_reset_token_expires``) are
still read: ``_upgrade`` turns them into the records once, before any change reads the account,
and the follow-up named in ``docs/implementation/data/users-and-email.md`` deletes it whole.
"""
import hashlib
import math
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Callable, Dict, Optional, Tuple, Union

from pymongo import ReturnDocument

from utils.tokens import generate_otp, generate_reset_token

SECRETS_FIELD = "secrets"

SENDING = "sending"
LIVE = "live"
USED = "used"
DISCARDED = "discarded"

#: How long a code lasts once issued.
CODE_LIFE = timedelta(minutes=5)
#: How long after a mailed code expires the account may ask for the next.
CODE_WAIT = timedelta(hours=1)
#: How many tries reach one code before it is discarded.
CODE_TRIES = 5
#: How long a reset link lasts once issued.
RESET_LIFE = timedelta(hours=1)
#: How long after a mailed reset link expires the account may ask for the next.
RESET_WAIT = timedelta(hours=1)


def now() -> datetime:
    """The current time, in UTC; a function so a test can move the clock."""
    return datetime.now(timezone.utc)


def _salted_digest(salt: str, secret: str) -> str:
    return hashlib.sha256(f"{salt}:{secret}".encode("utf-8")).hexdigest()


def hash_code(code: str) -> str:
    """What is stored of a code: ``"<salt>:<sha256(salt:code)>"``, a new salt each time."""
    salt = secrets.token_hex(16)
    return f"{salt}:{_salted_digest(salt, code)}"


def code_matches(stored: Any, candidate: str) -> bool:
    """Whether ``candidate`` is the code ``stored`` was made from, compared in constant time."""
    if not isinstance(stored, str) or ":" not in stored:
        return False
    salt, expected = stored.split(":", 1)
    return secrets.compare_digest(expected, _salted_digest(salt, candidate))


def hash_link(link: str) -> str:
    """What is stored of a link: its hex SHA-256, by which the account it names is found."""
    return hashlib.sha256(link.encode("utf-8")).hexdigest()


def _utc(moment: Any) -> Optional[datetime]:
    """A stored datetime as UTC (the server hands one back naive), or None for anything else."""
    if not isinstance(moment, datetime):
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _seconds_until(moment: Any, at: datetime) -> Optional[int]:
    """The whole seconds from ``at`` until ``moment``, or None when it has come or is not stored."""
    until = _utc(moment)
    if until is None:
        return None
    left = (until - at).total_seconds()
    return math.ceil(left) if left > 0 else None


@dataclass(frozen=True)
class Kind:
    """One kind of secret, a row of the module's table."""

    name: str
    #: Makes a new secret to mail.
    make: Callable[[], str]
    #: What is stored of a secret.
    hashed: Callable[[str], str]
    #: How long a secret lasts from being issued.
    life: timedelta
    #: How long after a mailed secret expires the next may be issued.
    wait: timedelta
    #: What else the account must hold for a secret to be issued.
    issued_to: Dict[str, Any]
    #: The fields the account held this kind in before ``secrets``, read for one release.
    legacy_fields: Tuple[str, ...]
    #: The record those fields stand for, or None when they stand for none.
    from_legacy: Callable[[dict], Optional[dict]]

    def path(self, field: Optional[str] = None) -> str:
        """Where this kind is stored, or one field of it."""
        base = f"{SECRETS_FIELD}.{self.name}"
        return f"{base}.{field}" if field else base

    def record(self, account: Optional[dict]) -> Optional[dict]:
        """This kind's record on an account as read, or None."""
        held = (account or {}).get(SECRETS_FIELD) or {}
        record = held.get(self.name)
        return record if isinstance(record, dict) else None


def _legacy_moment(stored: Any) -> Optional[datetime]:
    """A moment the legacy fields stored as an ISO string, as UTC; None when there is none."""
    if not isinstance(stored, str):
        return None
    try:
        moment = datetime.fromisoformat(stored.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _code_from_legacy(account: dict) -> Optional[dict]:
    """The code the legacy fields hold: a stored ``otp`` is a live code, a cleared one with its
    expiry kept (five wrong tries cleared it) a discarded code keeping its wait. A code with no
    readable expiry, or no expiry at all (a used one), is none."""
    expires_at = _legacy_moment(account.get("otp_expires"))
    if expires_at is None:
        return None
    tries = account.get("otp_attempts")
    otp = account.get("otp")
    live = isinstance(otp, str) and bool(otp)
    return {
        "hash": hash_code(otp) if live else None,
        "expires_at": expires_at,
        "next_allowed_at": expires_at + CODE_WAIT,
        "tries": tries if isinstance(tries, int) and not isinstance(tries, bool) else 0,
        "state": LIVE if live else DISCARDED,
    }


CODE = Kind(
    name="code",
    # Looked up at each call, so a test can stand in for the generator.
    make=lambda: generate_otp(),
    hashed=hash_code,
    life=CODE_LIFE,
    wait=CODE_WAIT,
    issued_to={"email_verified": True},
    legacy_fields=("otp", "otp_expires", "otp_attempts"),
    from_legacy=_code_from_legacy,
)

def _reset_from_legacy(account: dict) -> Optional[dict]:
    """The reset link the legacy fields hold: a stored token is a live link, its wait running from
    its expiry. A link with no readable expiry, or none at all (a used one), is none."""
    expires_at = _legacy_moment(account.get("password_reset_token_expires"))
    if expires_at is None:
        return None
    token = account.get("password_reset_token")
    live = isinstance(token, str) and bool(token)
    return {
        "hash": hash_link(token) if live else None,
        "expires_at": expires_at,
        "next_allowed_at": expires_at + RESET_WAIT,
        "tries": 0,
        "state": LIVE if live else DISCARDED,
    }


RESET = Kind(
    name="reset",
    make=lambda: generate_reset_token(),
    hashed=hash_link,
    life=RESET_LIFE,
    wait=RESET_WAIT,
    # The owner of an address never verified may reset too: the link proves the mailbox.
    issued_to={},
    legacy_fields=("password_reset_token", "password_reset_token_expires"),
    from_legacy=_reset_from_legacy,
)

KINDS = (CODE, RESET)

#: The fields an account is found by from a link opened, each indexed (``lookup_indexes``): the
#: link's hash, and for one release the legacy field that held the link as mailed.
LOOKUP_FIELDS = (RESET.path("hash"), RESET.legacy_fields[0])

#: Every legacy field the module still reads, for the one release.
LEGACY_FIELDS = tuple(field for kind in KINDS for field in kind.legacy_fields)


def _upgrade(users, match: dict, account: Optional[dict] = None) -> None:
    """Turn the legacy fields of the account ``match`` names into records, once.

    ``account`` is the account as the caller read it, which saves the read; without it the account
    is read, and only when it holds a legacy field. One write per account, filtered on the legacy
    values read and on each kind it converts being absent, so a request that upgraded or issued
    meanwhile is left alone; it unsets every legacy field it read.
    """
    if account is None:
        account = users.find_one(
            {**match, "$or": [{field: {"$exists": True}} for field in LEGACY_FIELDS]},
            {"_id": 0, "id": 1, SECRETS_FIELD: 1, **{field: 1 for field in LEGACY_FIELDS}},
        )
    if not account or not any(field in account for field in LEGACY_FIELDS):
        return
    written: Dict[str, Any] = {}
    unset: Dict[str, str] = {}
    held: Dict[str, Any] = {"id": account["id"]}
    for kind in KINDS:
        if not any(field in account for field in kind.legacy_fields):
            continue
        held.update({field: account.get(field) for field in kind.legacy_fields})
        unset.update({field: "" for field in kind.legacy_fields})
        if kind.record(account) is None:
            held[kind.path()] = {"$exists": False}
            record = kind.from_legacy(account)
            if record is not None:
                written[kind.path()] = record
    update: Dict[str, Any] = {"$unset": unset}
    if written:
        update["$set"] = written
    users.update_one(held, update)


@dataclass(frozen=True)
class Issued:
    """A secret issued and not yet mailed: mail ``secret``, then say how the provider answered."""

    account_id: str
    secret: str
    hash: str
    expires_at: datetime


@dataclass(frozen=True)
class Wait:
    """A secret refused: the whole seconds until one may be issued, at least one."""

    seconds: int


def issue(users, kind: Kind, account: dict) -> Union[Issued, Wait, None]:
    """Issue a new secret of ``kind`` to ``account`` (as the caller read it), in one write.

    It is issued while no wait is ahead and no other secret of the kind is being mailed; the record
    becomes ``sending`` with no wait, and the account's legacy fields of the kind are unset.
    Refused, the answer is the wait, read once more from the account: what is left of
    ``next_allowed_at``, or for a secret being mailed, of its expiry and the kind's wait. None when
    the account is gone, or no longer holds what the kind is issued to.
    """
    _upgrade(users, {"id": account["id"]}, account)
    at = now()
    secret = kind.make()
    issued = Issued(account_id=account["id"], secret=secret, hash=kind.hashed(secret),
                    expires_at=at + kind.life)
    wrote = users.update_one(
        {
            "id": account["id"],
            **kind.issued_to,
            "$or": [{kind.path("next_allowed_at"): None},
                    {kind.path("next_allowed_at"): {"$lte": at}}],
            "$nor": [{kind.path("state"): SENDING, kind.path("expires_at"): {"$gt": at}}],
        },
        {
            "$set": {kind.path(): {
                "hash": issued.hash, "expires_at": issued.expires_at, "next_allowed_at": None,
                "tries": 0, "state": SENDING,
            }},
            "$unset": {field: "" for field in kind.legacy_fields},
        },
    )
    if wrote.matched_count == 1:
        return issued
    held = users.find_one({"id": account["id"], **kind.issued_to}, {"_id": 0, kind.path(): 1})
    if held is None:
        return None
    record = kind.record(held) or {}
    expires_at = _utc(record.get("expires_at"))
    if record.get("state") == SENDING and expires_at is not None and expires_at > at:
        left = _seconds_until(expires_at + kind.wait, at)
    else:
        left = _seconds_until(record.get("next_allowed_at"), at)
    return Wait(seconds=max(1, left or 0))


def _still_sending(kind: Kind, issued: Issued, at: datetime) -> dict:
    """The account while it holds this issued secret, unexpired and not yet mailed: a reset or a
    newer issue meanwhile is left alone."""
    return {
        "id": issued.account_id,
        kind.path("hash"): issued.hash,
        kind.path("state"): SENDING,
        kind.path("expires_at"): {"$gt": at},
    }


def accepted(users, kind: Kind, issued: Issued) -> None:
    """The provider took the mail: the secret is live, and the kind's wait is set."""
    users.update_one(
        _still_sending(kind, issued, now()),
        {"$set": {kind.path("state"): LIVE,
                  kind.path("next_allowed_at"): issued.expires_at + kind.wait}},
    )


def refused(users, kind: Kind, issued: Issued) -> None:
    """The provider refused the mail: the kind is unset, so no wait and no live secret is left,
    and the account may ask again at once."""
    users.update_one(_still_sending(kind, issued, now()), {"$unset": {kind.path(): ""}})


class Tried(Enum):
    """What one try of a code came to."""

    #: No live code with a try left, or not the code: answered alike.
    WRONG = "wrong"
    #: The code, past its life.
    EXPIRED = "expired"
    #: The code, live: ``use_code`` it to sign in.
    RIGHT = "right"


@dataclass(frozen=True)
class CodeTry:
    outcome: Tried
    #: For a right code, the account as the try left it.
    account: Optional[dict] = None
    #: For an expired code, the whole seconds until a new one may be asked for; None when now.
    wait: Optional[int] = None


def try_code(users, email: str, candidate: str) -> CodeTry:
    """Count one try of ``candidate`` on the account's live code, and say what it came to.

    The try is counted in the one write that finds the code, so no more than ``CODE_TRIES`` tries
    ever reach it, even when they arrive at once. The fifth wrong try discards it, keeping its
    wait; a right try past the code's life is answered expired and changes nothing more.
    """
    _upgrade(users, {"email": email})
    at = now()
    account = users.find_one_and_update(
        {"email": email, CODE.path("state"): LIVE, CODE.path("tries"): {"$lt": CODE_TRIES}},
        {"$inc": {CODE.path("tries"): 1}},
        return_document=ReturnDocument.AFTER,
    )
    record = CODE.record(account)
    if record is None:
        return CodeTry(Tried.WRONG)
    if not code_matches(record.get("hash"), candidate):
        if record.get("tries", 0) >= CODE_TRIES:
            users.update_one(
                {"email": email, CODE.path("hash"): record["hash"], CODE.path("state"): LIVE},
                {"$set": {CODE.path("state"): DISCARDED}},
            )
        return CodeTry(Tried.WRONG)
    expires_at = _utc(record.get("expires_at"))
    if expires_at is None or expires_at <= at:
        return CodeTry(Tried.EXPIRED, wait=_seconds_until(record.get("next_allowed_at"), at))
    return CodeTry(Tried.RIGHT, account=account)


def use_code(users, account: dict) -> bool:
    """Use the code a right try found, clearing its wait: True for the one try that used it, so of
    two right tries at once one signs in."""
    record = CODE.record(account) or {}
    used = users.update_one(
        {"email": account["email"], CODE.path("hash"): record.get("hash"),
         CODE.path("state"): LIVE},
        {"$set": {CODE.path("state"): USED, CODE.path("next_allowed_at"): None}},
    )
    return used.modified_count == 1


class Link(Enum):
    """What a link opened came to."""

    #: No live link of the kind has this hash: never mailed, used, or replaced.
    INVALID = "invalid"
    #: The link, past its life.
    EXPIRED = "expired"
    #: The link, live: use it.
    LIVE = "live"


def _the_legacy_link_field(kind: Kind) -> str:
    """The legacy field that held a kind's link as mailed, read for one release."""
    return kind.legacy_fields[0]


def find_link(users, kind: Kind, link: str) -> Link:
    """Say what ``link`` is, read without a write, only to tell an expired link from one that is
    not there; using it is a write of its own, which a link used meanwhile does not match.

    For one release a link mailed before this module is found by the legacy field equal to it, and
    the account is upgraded first, so the link is then found by its hash as any other.
    """
    _upgrade(users, {_the_legacy_link_field(kind): link})
    held = users.find_one({kind.path("hash"): kind.hashed(link), kind.path("state"): LIVE},
                          {"_id": 0, kind.path(): 1})
    record = kind.record(held)
    if record is None:
        return Link.INVALID
    expires_at = _utc(record.get("expires_at"))
    if expires_at is None or expires_at <= now():
        return Link.EXPIRED
    return Link.LIVE


def use_reset_link(users, link: str, password: str, login_id: str) -> bool:
    """Reset the password by the mailed ``link``, in one write found by the filter that names the
    live link: True for the one use that reset, so of two uses at once one resets.

    The write sets ``password`` (already hashed) and the new ``login_id``, which ends every sign-in
    issued before; marks the address verified, since following the link proves the mailbox; uses
    the link, clearing its wait; and ends every other secret the module keeps, the code among them,
    with every legacy field it reads.
    """
    used = users.find_one_and_update(
        {RESET.path("hash"): hash_link(link), RESET.path("state"): LIVE,
         RESET.path("expires_at"): {"$gt": now()}},
        {
            "$set": {"password": password, "login_id": login_id, "email_verified": True,
                     RESET.path("state"): USED, RESET.path("next_allowed_at"): None},
            "$unset": {**{kind.path(): "" for kind in KINDS if kind is not RESET},
                       **{field: "" for field in LEGACY_FIELDS}},
        },
        {"_id": 0, "id": 1},
    )
    return used is not None
