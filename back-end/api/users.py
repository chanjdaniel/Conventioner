import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Tuple
from flask import request, jsonify, session
from flask_login import UserMixin
from flask_login.utils import decode_cookie
from datatypes import MarketRole, OrganizationRole, User, organization_people_of
from db_config import get_database
from utils.email import (
    send_account_exists_email, send_verification_email, send_password_reset_email, send_otp_email
)
from utils.captcha import verify_recaptcha
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError, PyMongoError
from utils.email_address import normalized_email
from utils.request_body import flag_field, json_object, string_field
import account_secrets
import organizer_sessions
import sign_in_limits

db = get_database()
users_collection = db["users"]

#: One address is one account (E32/F03/S04): unique over the stored, lowercased address.
USER_EMAIL_INDEX = "user_email"
USER_EMAIL_MIGRATION = "migrations/migrate_user_emails.py"


class UserIndexError(RuntimeError):
    """The users collection cannot hold one account per address, so the process refuses to boot."""


def ensure_user_indexes() -> None:
    """One account per address, enforced where it can hold (E32/F03/S04).

    Register checked for an address and then inserted it - two steps a second request could fall
    between, and a double click on Register did, making two accounts for one address. Only a unique
    index can referee that, so it is built here and ``app.py`` refuses to boot without it, as it
    does for the applications' identity index. It is unique over the stored form, so an address not
    yet stored lowercased - written before every writer lowercased it - is refused first, naming the
    migration that rewrites it; and duplicates that stop the build are named, for the operator to
    resolve. A plain index on the same key, which the lookup indexes once built, is replaced: this
    is the one owner of the users' email index.
    """
    # Ids, never addresses: this refusal is printed to an operator's terminal and the host's logs.
    # Once the index stands it is the referee and every writer lowercases, so there is nothing left
    # to scan for - a boot on a serverless host is every cold start.
    if users_collection.index_information().get(USER_EMAIL_INDEX, {}).get("unique"):
        return
    stored = [
        (doc.get("id"), doc.get("email") or "")
        for doc in users_collection.find({}, {"id": 1, "email": 1})
    ]
    unnormalized = sorted(str(uid) for uid, email in stored if email != normalized_email(email))
    if unnormalized:
        raise UserIndexError(
            f"{len(unnormalized)} account(s) have an address not stored lowercased (ids: "
            f"{', '.join(unnormalized)}). Run: python {USER_EMAIL_MIGRATION}"
        )
    try:
        for name, info in users_collection.index_information().items():
            if list(info.get("key", [])) == [("email", 1)] and not info.get("unique"):
                users_collection.drop_index(name)
        users_collection.create_index([("email", 1)], unique=True, name=USER_EMAIL_INDEX)
    except PyMongoError as exc:
        # The driver's message is not repeated, nor kept as the cause: a duplicate key error
        # quotes the address.
        by_address: dict = {}
        for uid, email in stored:
            by_address.setdefault(email, []).append(str(uid))
        shared = [ids for ids in by_address.values() if len(ids) > 1]
        raise UserIndexError(
            f"Could not build the unique index {USER_EMAIL_INDEX!r} on users.email "
            f"({type(exc).__name__}, code {getattr(exc, 'code', None)}). Accounts sharing an "
            f"address: {'; '.join(', '.join(ids) for ids in shared) or 'none found'}. Keep one "
            f"account per address, then restart."
        ) from None


#: How long a sign-in lasts without "Remember me", and with it (``organizer_sessions``).
SIGN_IN_LIFETIME = organizer_sessions.SIGN_IN_LIFETIME
REMEMBERED_SIGN_IN_LIFETIME = organizer_sessions.REMEMBERED_SIGN_IN_LIFETIME

#: The remember cookie an organizer's sign-in sets (``app.py``'s ``REMEMBER_COOKIE_NAME``): its
#: ``__Host-`` prefix holds it to the API's host.
REMEMBER_COOKIE = "__Host-organizer_remember"

#: The remember cookie the sign-ins made before they were kept on the server set, read for one
#: release (``legacy_remembered_account``) and deleted by every sign-in and sign-out.
LEGACY_REMEMBER_COOKIE = "remember_token"

#: The kinds of sign-in a legacy sign-in id names, and how long each lasts.
_LIFETIMES = {"s": SIGN_IN_LIFETIME, "r": REMEMBERED_SIGN_IN_LIFETIME}

#: What a refused sign-in says (E38/F14/S02), in the sign-in screen's words, each with what to do
#: next beside it on the screen. A wrong password and an address with no account say the same.
SIGN_IN_DOES_NOT_MATCH = "That email and password do not match."
#: The screen offers "Send the link again" beside it.
SIGN_IN_VERIFY_FIRST = "Verify your email address first: we sent you a link when you registered."
#: A code that is not the one sent, and a code for an address with no account, alike at every try:
#: an account's fifth wrong code discards its code without saying so, and the sign-in limits count
#: every address's tries alike.
SIGN_IN_WRONG_CODE = "That code is not right."

#: What a right code that has expired says, followed by when a new code may be asked for
#: (``_next_code``).
CODE_EXPIRED = "That code has expired."
#: When a new code may be asked for: ``{wait}`` is what is left of the account's wait, which ends an
#: hour after its last code expired; with no wait left, at once.
NEXT_CODE_LATER = "You can ask for a new code in {wait}."
NEXT_CODE_NOW = "Ask for a new one."

#: What a code request answers once the code is mailed, and for an address with no account alike.
CODE_SENT = "If an account exists for that address, a sign-in code has been sent to it."

#: When another reset link may be asked for: ``{wait}`` is what is left of the account's wait, which
#: ends an hour after its last link expired (``account_secrets.RESET_WAIT``).
NEXT_RESET_LATER = "You can ask for another reset link in {wait}."

#: What a reset-link request says whether or not the address has an account.
RESET_SENT = "If an account exists, a password reset email has been sent"

#: What a reset by a link that is not live says: never mailed, used, replaced, or used meanwhile.
RESET_INVALID = "Invalid reset token"

#: What a verification resend says once the link is mailed, or while another is being mailed.
VERIFICATION_SENT = "Verification email sent"

#: What a verification resend says for an address with no account.
VERIFICATION_NO_ACCOUNT = "If an account exists, a verification email has been sent"

#: What a verification resend, or a verification link, says of an address already verified.
ALREADY_VERIFIED = "Email already verified"

#: What a verification link that is not live says: never mailed, used, replaced, or used meanwhile.
VERIFY_INVALID = "Invalid verification token"

#: What a sign-in past its limit says (``sign_in_limits``), ``{wait}`` being the time left of the
#: limit's window; the password form puts "Forgot password?" beside it.
SIGN_IN_TOO_MANY = "Too many sign-in attempts. Try again in {wait}, or reset your password."

#: What a request that sends a mail (a code, a reset link, a verification link, a sign-up) says
#: past its limit, ``{wait}`` being the time left of the limit's window.
ASKED_TOO_OFTEN = "You have asked several times. Try again in {wait}."

#: The most of a password bcrypt reads, in UTF-8 bytes: bcrypt 5 refuses to hash or check a longer
#: one, so it is refused at sign-up and at a reset and answers a sign-in as a password that does
#: not match.
PASSWORD_MAX_BYTES = 72

#: What a sign-up or a reset with a password longer than ``PASSWORD_MAX_BYTES`` says.
PASSWORD_TOO_LONG = ("That password is too long. Use 72 characters or fewer; an accented letter or "
                     "an emoji counts as more than one.")

#: What a password for an address with no account is checked against, made once at the app's cost
#: factor, so that a sign-in takes as long with an account as without one.
_no_account_hash: Optional[str] = None


def _longer_than_bcrypt_reads(password: str) -> bool:
    return len(password.encode("utf-8")) > PASSWORD_MAX_BYTES


def _password_matches(bcrypt, user_doc, password: str) -> bool:
    """Whether the password is the account's, checked whether or not there is an account.

    A password longer than bcrypt reads matches no account, and is checked against nothing: no
    stored hash was made from one.
    """
    global _no_account_hash
    if _longer_than_bcrypt_reads(password):
        return False
    if user_doc:
        return bcrypt.check_password_hash(user_doc["password"], password)
    if _no_account_hash is None:
        _no_account_hash = bcrypt.generate_password_hash(secrets.token_urlsafe(32)).decode("utf-8")
    bcrypt.check_password_hash(_no_account_hash, password)
    return False


def _now() -> float:
    """The server's clock, in seconds since the epoch."""
    return time.time()


@dataclass(frozen=True)
class _Bounds:
    """How one sign-in route is bounded (``sign_in_limits``): a limit per caller and per address,
    and the sentence its refusal says under the key the route's other answers use.

    Every bounded route keeps one order: the caller is counted before the body is read, and the
    normalized address before any account is looked up, so a refusal is the same for every address
    and never depends on whether a password or a code was right. A route whose try signed in takes
    both counts back with the ``now`` it counted them with.
    """

    per_caller: sign_in_limits.SignInLimit
    per_address: sign_in_limits.SignInLimit
    sentence: str
    key: str

    def caller_refusal(self, now: datetime) -> Optional[Tuple[Any, int]]:
        """The 429 when this caller is past its limit, else None; counts the try either way."""
        return self._refusal(self.per_caller, sign_in_limits.caller(), now)

    def address_refusal(self, email: str, now: datetime) -> Optional[Tuple[Any, int]]:
        """The 429 when this address is past its limit, else None; counts the try either way."""
        return self._refusal(self.per_address, email, now)

    def take_back(self, email: str, now: datetime) -> None:
        """Take back a try that signed in, from the caller's count and the address's."""
        sign_in_limits.take_back_attempt(self.per_caller, sign_in_limits.caller(), now)
        sign_in_limits.take_back_attempt(self.per_address, email, now)

    def _refusal(self, limit, subject: str, now: datetime):
        retry_after = sign_in_limits.count_attempt(limit, subject, now)
        return sign_in_limits.too_many(retry_after, self.sentence, key=self.key)


_PASSWORD_SIGN_IN = _Bounds(
    sign_in_limits.PASSWORD_PER_CALLER, sign_in_limits.PASSWORD_PER_ADDRESS,
    SIGN_IN_TOO_MANY, "message",
)


_CODE_SIGN_IN = _Bounds(
    sign_in_limits.ORGANIZER_CODE_PER_CALLER, sign_in_limits.ORGANIZER_CODE_PER_ADDRESS,
    SIGN_IN_TOO_MANY, "msg",
)


_CODE_REQUEST = _Bounds(
    sign_in_limits.ORGANIZER_CODE_REQUEST_PER_CALLER,
    sign_in_limits.ORGANIZER_CODE_REQUEST_PER_ADDRESS,
    ASKED_TOO_OFTEN, "msg",
)
_RESET_LINK = _Bounds(
    sign_in_limits.RESET_LINK_PER_CALLER, sign_in_limits.RESET_LINK_PER_ADDRESS,
    ASKED_TOO_OFTEN, "msg",
)
_VERIFICATION_LINK = _Bounds(
    sign_in_limits.VERIFICATION_LINK_PER_CALLER, sign_in_limits.VERIFICATION_LINK_PER_ADDRESS,
    ASKED_TOO_OFTEN, "msg",
)
_SIGN_UP = _Bounds(
    sign_in_limits.SIGN_UP_PER_CALLER, sign_in_limits.SIGN_UP_PER_ADDRESS,
    ASKED_TOO_OFTEN, "msg",
)


def _limit_clock() -> datetime:
    """The moment a bounded request is counted at, which its take-back is counted at too."""
    return datetime.fromtimestamp(_now(), tz=timezone.utc)


def _next_code(wait: Optional[int]) -> str:
    """When a new code may be asked for, ``wait`` seconds from now or at once, in the words a
    refused code ends with."""
    if wait is None:
        return NEXT_CODE_NOW
    return NEXT_CODE_LATER.format(wait=sign_in_limits.wait_in_words(wait))


# users
class AuthUser(UserMixin):
    """A signed-in account.

    The session and the remember cookie name it by its sign-in (``sign_in``): the secret whose hash
    keys its record in ``organizer_sessions``, or for one release a legacy sign-in id
    (``_legacy_account``). Either loads the account by its login id, so the one write that replaces
    the login id, a password reset's or Sign out everywhere's, ends every sign-in issued before.
    """

    def __init__(self, user: User, sign_in: Optional[str] = None):
        self.id = user.id
        self.email = user.email
        self.organizations = user.organizations
        self.login_id = user.login_id
        self.sign_in = sign_in

    def get_id(self):
        return self.sign_in


def _new_login_id() -> str:
    return secrets.token_urlsafe(32)


def get_user_by_login_id(login_id):
    """The account with this login id, or None.

    There is no fallback to the address a session named before login ids: that would keep every
    remember-me cookie issued before them, and before a reset, signing in.
    """
    if not isinstance(login_id, str) or not login_id:
        return None
    user_doc = users_collection.find_one({"login_id": login_id})
    if user_doc:
        user_doc.pop('_id', None)
        return AuthUser(User(**user_doc))
    return None


def is_legacy_sign_in(sign_in) -> bool:
    """Whether ``sign_in`` has a legacy sign-in id's shape, ``<login id>.<s|r>.<seconds>``.

    A secret holds no ``.`` (``secrets.token_urlsafe``), so the two shapes cannot be confused.
    """
    return isinstance(sign_in, str) and "." in sign_in


def _legacy_account(sign_in: str):
    """The account a legacy sign-in id names, or None, read for one release.

    ``<login id>.<s|r>.<whole seconds since the epoch>``, as sign-ins were named before they were
    kept on the server: None once it is as old as its kind's length (``SIGN_IN_LIFETIME``, or
    ``REMEMBERED_SIGN_IN_LIFETIME`` when remembered), and for an id of any other shape, the bare
    login id that came before it among them.
    """
    parts = sign_in.rsplit(".", 2)
    if len(parts) != 3:
        return None
    login_id, kind, signed_in_at = parts
    lifetime = _LIFETIMES.get(kind)
    if lifetime is None or not (signed_in_at.isascii() and signed_in_at.isdigit()):
        return None
    if _now() - int(signed_in_at) >= lifetime.total_seconds():
        return None
    return get_user_by_login_id(login_id)


def signed_in_account(sign_in):
    """The account a session or remember cookie names, or None: the app's user loader.

    A secret is recalled from ``organizer_sessions``: None once its sign-in has ended (signed out,
    replaced by a sign-in in the browser, ended by Sign out everywhere, a reset or the account's
    deletion, or past the end its record holds), and None when its account's login id is no
    longer the one the record was made under. For one release a legacy sign-in id is read too
    (``_legacy_account``).
    """
    if not isinstance(sign_in, str) or not sign_in:
        return None
    if is_legacy_sign_in(sign_in):
        account = _legacy_account(sign_in)
    else:
        recalled = organizer_sessions.recall(sign_in)
        if recalled is None:
            return None
        user_id, login_id = recalled
        account = get_user_by_login_id(login_id)
        if account is not None and account.id != user_id:
            return None
    if account is not None:
        account.sign_in = sign_in
    return account


def legacy_remembered_account(cookie: Optional[str]):
    """``(sign_in, account)`` for the legacy ``remember_token`` cookie, or None, read for one
    release: the sign-in id it carries, so the caller can restore the session, and its account.

    ``cookie`` is the cookie's value, signed by Flask-Login's digest; only a legacy sign-in id in
    it is read.
    """
    sign_in = decode_cookie(cookie) if isinstance(cookie, str) and cookie else None
    if not is_legacy_sign_in(sign_in):
        return None
    account = _legacy_account(sign_in)
    if account is None:
        return None
    account.sign_in = sign_in
    return sign_in, account


def end_this_browsers_sign_ins() -> None:
    """End, on the server, every sign-in this request's browser holds, whoever's it is: the one its
    session names and the one its remember cookie names. A legacy sign-in has no record to end;
    replacing the login id is what ends it."""
    held = [session.get("_user_id")]
    remembered = request.cookies.get(REMEMBER_COOKIE)
    if remembered:
        held.append(decode_cookie(remembered))
    for sign_in in dict.fromkeys(held):
        if isinstance(sign_in, str) and sign_in and not is_legacy_sign_in(sign_in):
            organizer_sessions.end(sign_in)


def _sign_in(login_user, user_doc, remember: bool):
    """Sign the account in for one of the two lengths, giving it a login id at its first sign-in.

    The sign-in the browser held before is ended first, whoever's it was; the new one is kept on
    the server (``organizer_sessions``) under the account's login id. The login id is written only
    where none is stored, then read back, so two first sign-ins at once agree on one.
    """
    if not user_doc.get("login_id"):
        users_collection.update_one(
            {"id": user_doc["id"], "login_id": None}, {"$set": {"login_id": _new_login_id()}}
        )
        stored = users_collection.find_one({"id": user_doc["id"]})
        if not stored or not stored.get("login_id"):
            # Not a refusal: the account was there a moment ago. The error handler logs it and
            # answers the server's fault.
            raise RuntimeError("an account's login id was not stored at its first sign-in")
        user_doc["login_id"] = stored["login_id"]

    end_this_browsers_sign_ins()
    user_doc.pop('_id', None)
    auth_user = AuthUser(
        User(**user_doc),
        sign_in=organizer_sessions.start(user_doc["id"], user_doc["login_id"], remember),
    )
    if remember:
        login_user(auth_user, remember=True, duration=REMEMBERED_SIGN_IN_LIFETIME)
    else:
        login_user(auth_user, remember=False)
        # A browser remembered by an earlier sign-in is not once this one chose otherwise:
        # Flask-Login deletes the cookie on the way out, as it does at sign-out.
        if REMEMBER_COOKIE in request.cookies:
            session["_remember"] = "clear"

    user_data = {
        "id": auth_user.id,
        "email": auth_user.email,
        "organizations": auth_user.organizations
    }
    return jsonify({"message": "Login successful", "user_data": user_data}), 200

def get_user(email):
    """Load user from MongoDB using email as the key"""
    user_doc = users_collection.find_one({"email": normalized_email(email)})
    if user_doc:
        # Remove MongoDB's _id field before creating User object
        user_doc.pop('_id', None)
        return AuthUser(User(**user_doc))
    return None


#: What a sign-up the checks pass answers, whether or not its address has an account.
SIGNED_UP = "User registered successfully. Please check your email to verify your account."
#: What a sign-up whose email was not sent answers, whether or not its address has an account.
SIGN_UP_SEND_FAILED = ("Registration failed: Unable to send verification email. Please check your "
                       "email configuration or contact support.")


def _signed_up():
    return jsonify({"msg": SIGNED_UP}), 201


def _sign_up_send_failed():
    return jsonify({"msg": SIGN_UP_SEND_FAILED, "error": "email_send_failed"}), 500


def _answer_a_taken_address(email: str):
    """A sign-up for an address that has an account: the account's owner is told by email.

    It answers as a new address's sign-up does, sent or not, and changes nothing on the account.
    """
    if not send_account_exists_email(email):
        return _sign_up_send_failed()
    return _signed_up()


def _insert_unless_taken(user_doc: dict):
    """Insert a new account, or None when its address is taken.

    The unique index refuses an address a concurrent request took after the caller's own check.
    """
    try:
        return users_collection.insert_one(user_doc)
    except DuplicateKeyError:
        return None


def login(bcrypt, login_user):
    """The password sign-in, bounded per caller and per address (``_Bounds``).

    A right password takes its try back, whether it signs in or answers that the address needs
    verifying first, so only wrong passwords pile up.
    """
    now = _limit_clock()
    refused = _PASSWORD_SIGN_IN.caller_refusal(now)
    if refused:
        return refused

    data = json_object(required=False)
    email = normalized_email(string_field(data, "email"))
    password = string_field(data, "password")

    if not email or not password:
        return jsonify({"message": "Email and password required"}), 400

    refused = _PASSWORD_SIGN_IN.address_refusal(email, now)
    if refused:
        return refused

    user_doc = users_collection.find_one({"email": email})
    if _password_matches(bcrypt, user_doc, password):
        _PASSWORD_SIGN_IN.take_back(email, now)
        if not user_doc.get("email_verified", False):
            return jsonify({"message": SIGN_IN_VERIFY_FIRST}), 403

        return _sign_in(login_user, user_doc, flag_field(data, "remember"))

    return jsonify({"message": SIGN_IN_DOES_NOT_MATCH}), 401

def logout(logout_user):
    """Sign out: end this browser's sign-in on the server, so a copy of its cookies stops working
    too, then clear both cookies."""
    end_this_browsers_sign_ins()
    logout_user()
    return jsonify({"message": "Logged out"}), 200


def logout_everywhere(current_user, logout_user):
    """Sign out everywhere: end every sign-in of the account, this browser's with it, then clear
    both cookies.

    The one write that replaces the login id ends every sign-in issued before, a legacy one
    included, as a reset's does; ending every record of the account's sign-ins is the clean-up
    after it. A failed write is the error handler's 500, and leaves the person signed in.
    """
    users_collection.update_one({"id": current_user.id}, {"$set": {"login_id": _new_login_id()}})
    organizer_sessions.end_all(current_user.id)
    logout_user()
    return jsonify({"message": "Signed out everywhere"}), 200

def check_session(current_user):
    return jsonify({"email": current_user.email}), 200


def register_user_with_captcha(bcrypt):
    """Register a new user with CAPTCHA verification, bounded per caller and per address
    (``_Bounds``) before the captcha is checked, so a refused sign-up spends no check.

    A sign-up answers alike whether or not its address has an account: the address's format and
    the password's rules are checked before the account is looked up, the password is hashed
    either way, and the answer is the same. A new address is sent its verification link; an
    address with an account, found by the lookup or by the unique index when a concurrent sign-up
    took it, is sent one email saying so instead (``_answer_a_taken_address``).
    """
    now = _limit_clock()
    refused = _SIGN_UP.caller_refusal(now)
    if refused:
        return refused

    data = json_object(required=False)
    email = normalized_email(string_field(data, "email"))
    password = string_field(data, "password")
    captcha_token = string_field(data, "captcha_token")

    if not email or not password:
        return jsonify({"msg": "Email and password required"}), 400

    if not captcha_token:
        return jsonify({"msg": "CAPTCHA verification required"}), 400

    refused = _SIGN_UP.address_refusal(email, now)
    if refused:
        return refused

    # Verify CAPTCHA
    ip_address = request.remote_addr
    captcha_success, captcha_score = verify_recaptcha(captcha_token, ip_address)
    if not captcha_success:
        return jsonify({"msg": "CAPTCHA verification failed"}), 400

    # Validate email format
    if "@" not in email or "." not in email.split("@")[1]:
        return jsonify({"msg": "Invalid email format"}), 400

    # The password: at least 8 characters, and no longer than bcrypt reads
    if len(password) < 8:
        return jsonify({"msg": "Password must be at least 8 characters long"}), 400
    if _longer_than_bcrypt_reads(password):
        return jsonify({"msg": PASSWORD_TOO_LONG}), 400

    # Hashed before the lookup, so a taken address costs the work a new one does.
    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')

    if users_collection.find_one({"email": email}):
        return _answer_a_taken_address(email)

    # The account is stored holding its verification link, being mailed.
    account_id = str(uuid.uuid4())
    issued, holding_the_link = account_secrets.issue_with_a_new_account(
        account_secrets.VERIFY, account_id)
    user_doc = {
        "id": account_id,
        "email": email,
        "password": hashed_password,
        "organizations": [],
        "email_verified": False,
        **holding_the_link,
    }

    result = _insert_unless_taken(user_doc)
    if result is None:
        return _answer_a_taken_address(email)

    if result.inserted_id:
        if not send_verification_email(email, issued.secret):
            # Email failed - rollback user creation to prevent orphaned unverified accounts
            users_collection.delete_one({"_id": result.inserted_id})
            return _sign_up_send_failed()

        account_secrets.accepted(users_collection, account_secrets.VERIFY, issued)
        return _signed_up()
    else:
        return jsonify({"msg": "Failed to register user"}), 500


def verify_email():
    """Verify the address by the mailed link (``account_secrets.use_verification_link``).

    The link is read first only to tell an expired link from one that is not there; using it is
    one write found by the live link, so a link used meanwhile is answered as one that is not
    there.
    """
    data = json_object(required=False)
    token = string_field(data, "token")

    if not token:
        return jsonify({"msg": "Verification token required"}), 400

    found = account_secrets.find_link(users_collection, account_secrets.VERIFY, token)
    if found is account_secrets.Link.INVALID:
        return jsonify({"msg": VERIFY_INVALID}), 400
    if found is account_secrets.Link.EXPIRED:
        return jsonify({"msg": "Verification token has expired"}), 400

    already = account_secrets.use_verification_link(users_collection, token)
    if already is None:
        return jsonify({"msg": VERIFY_INVALID}), 400
    if already:
        return jsonify({"msg": ALREADY_VERIFIED}), 400

    return jsonify({"msg": "Email verified successfully"}), 200


def resend_verification_email():
    """Mail the verification link again, bounded per caller and per address (``_Bounds``).

    A new link replaces the last, and may be asked for at once (``account_secrets.VERIFY``), but
    while another request's link is being mailed the request mails none and answers as sent, since
    one link is on its way. A link the provider refused is unset, so no link is left live: the one
    mailed before was replaced when this one was issued.
    """
    now = _limit_clock()
    refused = _VERIFICATION_LINK.caller_refusal(now)
    if refused:
        return refused

    data = json_object(required=False)
    email = normalized_email(string_field(data, "email"))

    if not email:
        return jsonify({"msg": "Email required"}), 400

    refused = _VERIFICATION_LINK.address_refusal(email, now)
    if refused:
        return refused

    user_doc = users_collection.find_one({"email": email})
    if not user_doc:
        # Don't reveal if user exists for security
        return jsonify({"msg": VERIFICATION_NO_ACCOUNT}), 200

    if user_doc.get("email_verified", False):
        return jsonify({"msg": ALREADY_VERIFIED}), 400

    issued = account_secrets.issue(users_collection, account_secrets.VERIFY, user_doc)
    if issued is None:
        return jsonify({"msg": VERIFICATION_NO_ACCOUNT}), 200
    if isinstance(issued, account_secrets.Wait):
        return jsonify({"msg": VERIFICATION_SENT}), 200

    if not send_verification_email(email, issued.secret):
        account_secrets.refused(users_collection, account_secrets.VERIFY, issued)
        return jsonify({"msg": "Failed to send verification email"}), 500

    account_secrets.accepted(users_collection, account_secrets.VERIFY, issued)
    return jsonify({"msg": VERIFICATION_SENT}), 200


def request_password_reset():
    """Mail a reset link, bounded per caller and per address (``_Bounds``).

    One link at a time (``account_secrets``): refused until an hour after the last mailed link
    expired, two hours after it was mailed, unless it was used, which clears its wait. The link is
    issued in one write, so of two requests at once one mails a link and the other is answered the
    wait. A link the provider refused is unset, so the next request may ask again at once.
    """
    now = _limit_clock()
    refused = _RESET_LINK.caller_refusal(now)
    if refused:
        return refused

    data = json_object(required=False)
    email = normalized_email(string_field(data, "email"))

    if not email:
        return jsonify({"msg": "Email required"}), 400

    refused = _RESET_LINK.address_refusal(email, now)
    if refused:
        return refused

    user_doc = users_collection.find_one({"email": email})
    if not user_doc:
        # Don't reveal if user exists for security
        return jsonify({"msg": RESET_SENT}), 200

    issued = account_secrets.issue(users_collection, account_secrets.RESET, user_doc)
    if issued is None:
        return jsonify({"msg": RESET_SENT}), 200
    if isinstance(issued, account_secrets.Wait):
        return jsonify(
            {"msg": NEXT_RESET_LATER.format(wait=sign_in_limits.wait_in_words(issued.seconds))}), 429

    if not send_password_reset_email(email, issued.secret):
        account_secrets.refused(users_collection, account_secrets.RESET, issued)
        return jsonify({"msg": "Failed to send password reset email"}), 500

    account_secrets.accepted(users_collection, account_secrets.RESET, issued)
    return jsonify({"msg": RESET_SENT}), 200


def reset_password(bcrypt):
    """Reset the password by the mailed link (``account_secrets.use_reset_link``).

    The link is read first only to tell an expired link from one that is not there; the reset is
    one write found by the live link, so of two uses at once one resets and the other is answered
    as a link that is not there. The write verifies the address, ends the account's code and
    verification link, and replaces the login id, which signs out every session and remember
    cookie issued before; every record of the account's sign-ins is then ended.
    """
    data = json_object(required=False)
    token = string_field(data, "token")
    new_password = string_field(data, "new_password")

    if not token or not new_password:
        return jsonify({"msg": "Token and new password required"}), 400

    # The password: at least 8 characters, and no longer than bcrypt reads
    if len(new_password) < 8:
        return jsonify({"msg": "Password must be at least 8 characters long"}), 400
    if _longer_than_bcrypt_reads(new_password):
        return jsonify({"msg": PASSWORD_TOO_LONG}), 400

    found = account_secrets.find_link(users_collection, account_secrets.RESET, token)
    if found is account_secrets.Link.INVALID:
        return jsonify({"msg": RESET_INVALID}), 400
    if found is account_secrets.Link.EXPIRED:
        return jsonify({"msg": "Reset token has expired"}), 400

    hashed_password = bcrypt.generate_password_hash(new_password).decode('utf-8')

    account_id = account_secrets.use_reset_link(users_collection, token, hashed_password,
                                                _new_login_id())
    if account_id is None:
        return jsonify({"msg": RESET_INVALID}), 400
    organizer_sessions.end_all(account_id)

    return jsonify({"msg": "Password reset successfully"}), 200


def request_otp():
    """Mail a sign-in code, bounded per caller and per address (``_Bounds``).

    One code at a time (``account_secrets``): refused until an hour after the last mailed code
    expired, unless it was used, which clears its wait; a code five wrong tries discarded keeps its
    wait. The code is issued in one write, so of two requests at once one mails a code and the other
    is answered the wait. A code the provider refused is unset, so the next request may ask again
    at once.
    """
    now = _limit_clock()
    refused = _CODE_REQUEST.caller_refusal(now)
    if refused:
        return refused

    data = json_object(required=False)
    email = normalized_email(string_field(data, "email"))

    if not email:
        return jsonify({"msg": "Email required"}), 400

    refused = _CODE_REQUEST.address_refusal(email, now)
    if refused:
        return refused

    user_doc = users_collection.find_one({"email": email})
    if not user_doc:
        # Don't reveal if user exists for security
        return jsonify({"msg": CODE_SENT}), 200

    if not user_doc.get("email_verified", False):
        return jsonify({"msg": SIGN_IN_VERIFY_FIRST}), 403

    issued = account_secrets.issue(users_collection, account_secrets.CODE, user_doc)
    if issued is None:
        return jsonify({"msg": CODE_SENT}), 200
    if isinstance(issued, account_secrets.Wait):
        return jsonify(
            {"msg": NEXT_CODE_LATER.format(wait=sign_in_limits.wait_in_words(issued.seconds))}), 429

    if not send_otp_email(email, issued.secret):
        account_secrets.refused(users_collection, account_secrets.CODE, issued)
        return jsonify({"msg": "The sign-in code could not be sent. Please try again."}), 500

    account_secrets.accepted(users_collection, account_secrets.CODE, issued)
    return jsonify({"msg": CODE_SENT}), 200


def login_with_otp(login_user):
    """The code sign-in, bounded per caller and per address (``_Bounds``) as the password is.

    A try is counted on the code in the same write that finds it (``account_secrets.try_code``),
    so no more than ``account_secrets.CODE_TRIES`` tries ever reach one code, even when they arrive
    at once; a right code takes its try back, whether it signs in or answers that the address needs
    verifying first.
    """
    now = _limit_clock()
    refused = _CODE_SIGN_IN.caller_refusal(now)
    if refused:
        return refused

    data = json_object(required=False)
    email = normalized_email(string_field(data, "email"))
    otp = string_field(data, "otp")

    if not email or not otp:
        return jsonify({"msg": "Enter your email address and the code."}), 400

    refused = _CODE_SIGN_IN.address_refusal(email, now)
    if refused:
        return refused

    # No account, no live code, a code whose tries are all counted, or not the code: alike.
    tried = account_secrets.try_code(users_collection, email, otp)
    if tried.outcome is account_secrets.Tried.WRONG:
        return jsonify({"msg": SIGN_IN_WRONG_CODE}), 401
    if tried.outcome is account_secrets.Tried.EXPIRED:
        return jsonify({"msg": f"{CODE_EXPIRED} {_next_code(tried.wait)}"}), 400

    user_doc = tried.account
    if not user_doc.get("email_verified", False):
        _CODE_SIGN_IN.take_back(email, now)
        return jsonify({"msg": SIGN_IN_VERIFY_FIRST}), 403

    # Used only if it is still this code: of two right tries, one signs in.
    if not account_secrets.use_code(users_collection, user_doc):
        return jsonify({"msg": SIGN_IN_WRONG_CODE}), 401

    _CODE_SIGN_IN.take_back(email, now)
    return _sign_in(login_user, user_doc, flag_field(data, "remember"))


def get_user_by_id(user_id: str):
    """Load user from MongoDB using id."""
    user_doc = users_collection.find_one({"id": user_id})
    if user_doc:
        user_doc.pop('_id', None)
        return AuthUser(User(**user_doc))
    return None


def get_users_by_ids(user_ids: Iterable[str]) -> Dict[str, AuthUser]:
    """The accounts with these ids, by id, read in one ``find`` over the indexed ``id`` (T204).

    An id with no account is left out; no ids read nothing. A read that names many people - the
    market's, the organizations' - reads them all here at once, never one ``get_user_by_id`` each.
    """
    wanted = list(dict.fromkeys(user_ids))
    if not wanted:
        return {}
    found: Dict[str, AuthUser] = {}
    for user_doc in users_collection.find({"id": {"$in": wanted}}):
        user_doc.pop('_id', None)
        found[user_doc["id"]] = AuthUser(User(**user_doc))
    return found


def get_user_raw(email: str) -> Optional[dict]:
    """Get raw user dict by email (for internal use)."""
    user_doc = users_collection.find_one({"email": normalized_email(email)})
    if user_doc:
        user_doc.pop('_id', None)
        return user_doc
    return None


#: Said of an account that is the Owner of markets, naming them: its Owner transfers each market's
#: ownership or deletes it first, as Manage market offers.
OWNS_MARKETS = "Transfer or delete {markets} before deleting this account."


def delete_user(authenticated_email: str):
    """Delete the authenticated user's own account.

    ``authenticated_email`` is the session's identity, supplied by the caller of this function and
    never by the HTTP request. An account is deletable by exactly one person: the one signed in to
    it. There is no unverified-account exception, because "unverified" is a property of the *target*
    and so let a stranger pick the target.

    An owner of an organization is refused rather than deleted. The previous behaviour deleted them
    and returned a warning asking someone to transfer ownership manually - but by then the owner id
    on the organization pointed at a user that no longer existed, stranding every market in it with
    nobody able to administer them. Ownership transfer is available while the account still exists
    (``POST /organizations/<id>/transfer-ownership``), so refusing here keeps the only ordering that
    leaves the data consistent. An owner with nobody to transfer to is not trapped either: deleting
    the organization is something its owner may do, and then this succeeds.

    The Owner of a market is refused for the same reason, beside the organization refusal (T283): a
    market's Owner is the only person who may delete it, manage its admins and change who may do
    what on it, so every market keeps an Owner whose account exists. Transferring its ownership
    (``POST /markets/<id>/hand-on``) or deleting it is something its Owner may do, and then this
    succeeds. A role below Owner on a market is not ownership, and the deletion goes ahead.
    """
    data = json_object(required=False)
    email_to_delete = normalized_email(string_field(data, "email"))

    if not email_to_delete:
        return jsonify({"msg": "Email address required"}), 400

    if email_to_delete != normalized_email(authenticated_email):
        # Deliberately the same answer whether or not the target exists: a caller may not use this
        # endpoint to discover which email addresses are registered.
        return jsonify({"msg": "You can only delete your own account"}), 403

    user_to_delete = users_collection.find_one({"email": email_to_delete})

    if not user_to_delete:
        return jsonify({"msg": "User not found"}), 404

    from api.organizations import organizations_collection
    import api.markets as MarketsApi
    from market_documents import market_doc_field, market_doc_key, market_doc_projection
    import organization_people as OrganizationPeople

    user_id_to_delete = user_to_delete.get("id")

    # Read by the person's one place in each organization they are in (T283).
    owned_orgs = [
        org for org in organizations_collection.find(OrganizationPeople.of_person(user_id_to_delete))
        if organization_people_of(org).get(user_id_to_delete) == OrganizationRole.OWNER
    ] if user_id_to_delete else []
    # The markets they are the Owner of, served by the `roles.$**` index (T283).
    owned_markets = list(MarketsApi.markets_collection.find(
        {f"{market_doc_key('roles')}.{user_id_to_delete}": MarketRole.OWNER.value},
        {"_id": 0, **market_doc_projection(["id", "name"])},
    )) if user_id_to_delete else []
    if owned_orgs or owned_markets:
        org_names = [org.get("name") for org in owned_orgs]
        market_names = [market_doc_field(market, "name") for market in owned_markets]
        sentences = []
        refusal: Dict[str, Any] = {}
        if org_names:
            sentences.append(
                f"Transfer ownership of {', '.join(org_names)} before deleting this account.")
            refusal["ownedOrganizations"] = org_names
        if market_names:
            sentences.append(OWNS_MARKETS.format(markets=', '.join(market_names)))
            refusal["ownedMarkets"] = market_names
        return jsonify({"msg": " ".join(sentences), **refusal}), 409

    result = users_collection.delete_one({"email": email_to_delete})

    if result.deleted_count > 0:
        # Membership elsewhere is not ownership, so it is safe to drop on the way out: their one
        # place in every organization they were an admin or a member of (T283).
        if user_id_to_delete:
            OrganizationPeople.forget(user_id_to_delete)
            organizer_sessions.end_all(user_id_to_delete)
        return jsonify({"msg": "User deleted successfully"}), 200

    return jsonify({"msg": "Failed to delete user"}), 500
