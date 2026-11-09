import secrets
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Tuple
from flask import current_app, request, jsonify, session
from flask_login import UserMixin
from flask_login.config import COOKIE_NAME
from datatypes import User
from db_config import get_database
from utils.tokens import (
    generate_verification_token, generate_reset_token, generate_otp,
    get_token_expiry, get_otp_expiry, verify_token_expiry
)
from utils.email import send_verification_email, send_password_reset_email, send_otp_email
from utils.captcha import verify_recaptcha
from datetime import datetime, timedelta, timezone
from pymongo.errors import DuplicateKeyError, PyMongoError
from utils.email_address import normalized_email
from utils.request_body import flag_field, string_field
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
        # The driver's message is not repeated: a duplicate key error quotes the address.
        by_address: dict = {}
        for uid, email in stored:
            by_address.setdefault(email, []).append(str(uid))
        shared = [ids for ids in by_address.values() if len(ids) > 1]
        raise UserIndexError(
            f"Could not build the unique index {USER_EMAIL_INDEX!r} on users.email "
            f"({type(exc).__name__}, code {getattr(exc, 'code', None)}). Accounts sharing an "
            f"address: {'; '.join(', '.join(ids) for ids in shared) or 'none found'}. Keep one "
            f"account per address, then restart."
        ) from exc


#: How long a sign-in without "Remember me" lasts (E38/F14/S01): a market day. Its session cookie
#: ends with the browser, and the server refuses it this long after signing in, since a browser
#: that restores its tabs restores its session cookies too.
SIGN_IN_LIFETIME = timedelta(hours=12)

#: How long a sign-in with "Remember me" lasts, from signing in: use does not extend it, so a lost
#: laptop is signed out within a month. The remember-me cookie expires then, and the server
#: refuses it then too, whatever the browser kept.
REMEMBERED_SIGN_IN_LIFETIME = timedelta(days=30)

#: The kinds of sign-in a sign-in id names, and how long each lasts.
_LIFETIMES = {"s": SIGN_IN_LIFETIME, "r": REMEMBERED_SIGN_IN_LIFETIME}

#: What a refused sign-in says (E38/F14/S02), in the sign-in screen's words, each with what to do
#: next beside it on the screen. A wrong password and an address with no account say the same.
SIGN_IN_DOES_NOT_MATCH = "That email and password do not match."
#: The screen offers "Send the link again" beside it.
SIGN_IN_VERIFY_FIRST = "Verify your email address first: we sent you a link when you registered."
#: A code that is not the one sent, and a code for an address with no account, alike up to an
#: account's fifth wrong code, which discards its code and says to ask for a new one; an address
#: with no account has no count, which the sign-in limits will keep for every address alike.
SIGN_IN_WRONG_CODE = "That code is not right."

#: What a sign-in past its limit says (``sign_in_limits``), ``{wait}`` being the time left of the
#: limit's window; the password form puts "Forgot password?" beside it.
SIGN_IN_TOO_MANY = "Too many sign-in attempts. Try again in {wait}, or reset your password."

#: The most of a password bcrypt reads, in UTF-8 bytes: bcrypt 5 refuses to hash or check a longer
#: one, so it is refused at sign-up and answers a sign-in as a password that does not match.
PASSWORD_MAX_BYTES = 72

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


def _limit_clock() -> datetime:
    """The moment a bounded request is counted at, which its take-back is counted at too."""
    return datetime.fromtimestamp(_now(), tz=timezone.utc)


def _sign_in_id(login_id: str, remembered: bool, signed_in_at: float) -> str:
    """What the session and the remember-me cookie carry: the account, the kind and the time.

    ``<login id>.<s|r>.<whole seconds since the epoch>``. The session is signed into its cookie with
    the app's ``SECRET_KEY`` by Flask, or kept on the server behind a random id by flask-session;
    the remember-me cookie is signed with ``SECRET_KEY`` by Flask-Login's digest. So a browser can
    change none of it.
    """
    return f"{login_id}.{'r' if remembered else 's'}.{int(signed_in_at)}"


# users
class AuthUser(UserMixin):
    """A signed-in account.

    The session and the remember-me cookie name it by a sign-in id (`_sign_in_id`), which holds its
    login id, not its address: a password reset replaces the login id, so every session and
    remember-me cookie issued before the reset stops loading the account.
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


def signed_in_account(sign_in):
    """The account a session or remember-me cookie names, or None: the app's user loader.

    None for a sign-in as old as its kind's length (`SIGN_IN_LIFETIME`, or
    `REMEMBERED_SIGN_IN_LIFETIME` when remembered), counted from signing in, and for an id of any
    other shape: every session and remember-me cookie issued before sign-ins carried their time
    named the bare login id, and is not read.
    """
    if not isinstance(sign_in, str):
        return None
    parts = sign_in.rsplit(".", 2)
    if len(parts) != 3:
        return None
    login_id, kind, signed_in_at = parts
    lifetime = _LIFETIMES.get(kind)
    if lifetime is None or not (signed_in_at.isascii() and signed_in_at.isdigit()):
        return None
    if _now() - int(signed_in_at) >= lifetime.total_seconds():
        return None
    account = get_user_by_login_id(login_id)
    if account is not None:
        account.sign_in = sign_in
    return account


def _sign_in(login_user, user_doc, remember: bool):
    """Sign the account in for one of the two lengths, giving it a login id at its first sign-in.

    The login id is written only where none is stored, then read back, so two first sign-ins at
    once agree on one.
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

    user_doc.pop('_id', None)
    auth_user = AuthUser(
        User(**user_doc), sign_in=_sign_in_id(user_doc["login_id"], remember, _now())
    )
    if remember:
        login_user(auth_user, remember=True, duration=REMEMBERED_SIGN_IN_LIFETIME)
    else:
        login_user(auth_user, remember=False)
        # A browser remembered by an earlier sign-in is not once this one chose otherwise:
        # Flask-Login deletes the cookie on the way out, as it does at sign-out.
        if current_app.config.get("REMEMBER_COOKIE_NAME", COOKIE_NAME) in request.cookies:
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

def _already_exists():
    return jsonify({"msg": "User already exists"}), 400


def _insert_unless_taken(user_doc: dict):
    """Insert a new account, or None when its address is taken.

    The unique index refuses an address a concurrent request took after the caller's own check.
    """
    try:
        return users_collection.insert_one(user_doc)
    except DuplicateKeyError:
        return None


# curl -k -X POST https://127.0.0.1:5001/register-user \
#      -H "Content-Type: application/json" \
#      -d '{"email": "USERNAME", "password": "pswrdpswrd!!!"}'
def register_user(bcrypt, request):
    data = request.json
    email = normalized_email(string_field(data, "email"))
    password = string_field(data, "password")

    if not email or not password:
        return jsonify({"msg": "Email and password required"}), 400

    # Check if user already exists in MongoDB
    existing_user = users_collection.find_one({"email": email})
    if existing_user:
        return _already_exists()

    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password": hashed_password,
        "organizations": []
    }
    
    result = _insert_unless_taken(user_doc)
    if result is None:
        return _already_exists()
    
    if result.inserted_id:
        return jsonify({"msg": "User registered successfully"}), 201
    else:
        return jsonify({"msg": "Failed to register user"}), 500

def login(bcrypt, login_user, request):
    """The password sign-in, bounded per caller and per address (``_Bounds``).

    A right password takes its try back, whether it signs in or answers that the address needs
    verifying first, so only wrong passwords pile up.
    """
    now = _limit_clock()
    refused = _PASSWORD_SIGN_IN.caller_refusal(now)
    if refused:
        return refused

    data = request.json
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
    logout_user()
    return jsonify({"message": "Logged out"}), 200

def check_session(current_user):
    return jsonify({"email": current_user.email}), 200


def register_user_with_captcha(bcrypt, request):
    """Register a new user with CAPTCHA verification."""
    data = request.json
    email = normalized_email(string_field(data, "email"))
    password = string_field(data, "password")
    captcha_token = string_field(data, "captcha_token")

    if not email or not password:
        return jsonify({"msg": "Email and password required"}), 400

    if not captcha_token:
        return jsonify({"msg": "CAPTCHA verification required"}), 400

    # Verify CAPTCHA
    ip_address = request.remote_addr
    captcha_success, captcha_score = verify_recaptcha(captcha_token, ip_address)
    if not captcha_success:
        return jsonify({"msg": "CAPTCHA verification failed"}), 400

    # Check if user already exists
    existing_user = users_collection.find_one({"email": email})
    if existing_user:
        return _already_exists()

    # Validate email format
    if "@" not in email or "." not in email.split("@")[1]:
        return jsonify({"msg": "Invalid email format"}), 400

    # Validate password strength (minimum 8 characters)
    if len(password) < 8:
        return jsonify({"msg": "Password must be at least 8 characters long"}), 400

    # Generate verification token
    verification_token = generate_verification_token()
    verification_token_expires = get_token_expiry(hours=1)

    # Hash password
    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    
    # Create user document
    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password": hashed_password,
        "organizations": [],
        "email_verified": False,
        "verification_token": verification_token,
        "verification_token_expires": verification_token_expires,
        "password_reset_token": None,
        "password_reset_token_expires": None,
        "otp": None,
        "otp_expires": None,
        "otp_attempts": 0
    }
    
    result = _insert_unless_taken(user_doc)
    if result is None:
        return _already_exists()
    
    if result.inserted_id:
        # Send verification email
        email_sent = send_verification_email(email, verification_token)
        if not email_sent:
            # Email failed - rollback user creation to prevent orphaned unverified accounts
            users_collection.delete_one({"_id": result.inserted_id})
            return jsonify({
                "msg": "Registration failed: Unable to send verification email. Please check your email configuration or contact support.",
                "error": "email_send_failed"
            }), 500
        
        return jsonify({
            "msg": "User registered successfully. Please check your email to verify your account."
        }), 201
    else:
        return jsonify({"msg": "Failed to register user"}), 500


def verify_email(request):
    """Verify user's email with token."""
    data = request.json
    token = string_field(data, "token")

    if not token:
        return jsonify({"msg": "Verification token required"}), 400

    # Find user with matching token
    user_doc = users_collection.find_one({"verification_token": token})
    
    if not user_doc:
        return jsonify({"msg": "Invalid verification token"}), 400

    # Check if token has expired
    expires_at = user_doc.get("verification_token_expires")
    if not verify_token_expiry(expires_at):
        return jsonify({"msg": "Verification token has expired"}), 400

    # Check if already verified
    if user_doc.get("email_verified", False):
        return jsonify({"msg": "Email already verified"}), 400

    # Update user to verified
    users_collection.update_one(
        {"email": user_doc["email"]},
        {
            "$set": {
                "email_verified": True,
                "verification_token": None,
                "verification_token_expires": None
            }
        }
    )

    return jsonify({"msg": "Email verified successfully"}), 200


def resend_verification_email(request):
    """Resend verification email to user."""
    data = request.json
    email = normalized_email(string_field(data, "email"))

    if not email:
        return jsonify({"msg": "Email required"}), 400

    # Find user
    user_doc = users_collection.find_one({"email": email})
    
    if not user_doc:
        # Don't reveal if user exists for security
        return jsonify({"msg": "If an account exists, a verification email has been sent"}), 200

    # Check if already verified
    if user_doc.get("email_verified", False):
        return jsonify({"msg": "Email already verified"}), 400

    # Generate new verification token
    verification_token = generate_verification_token()
    verification_token_expires = get_token_expiry(hours=1)

    # Update user with new token
    users_collection.update_one(
        {"email": email},
        {
            "$set": {
                "verification_token": verification_token,
                "verification_token_expires": verification_token_expires
            }
        }
    )

    # Send verification email
    email_sent = send_verification_email(email, verification_token)
    if not email_sent:
        return jsonify({"msg": "Failed to send verification email"}), 500

    return jsonify({"msg": "Verification email sent"}), 200


def request_password_reset(request):
    """Request password reset link."""
    data = request.json
    email = normalized_email(string_field(data, "email"))

    if not email:
        return jsonify({"msg": "Email required"}), 400

    # Find user
    user_doc = users_collection.find_one({"email": email})
    
    if not user_doc:
        # Don't reveal if user exists for security
        return jsonify({"msg": "If an account exists, a password reset email has been sent"}), 200

    # One link at a time: refused until an hour after the last link expired (two hours after it was
    # sent), unless that link was used, which clears its expiry.
    last_reset_time = user_doc.get("password_reset_token_expires")
    if last_reset_time:
        try:
            last_reset = datetime.fromisoformat(last_reset_time.replace('Z', '+00:00'))
            if last_reset.tzinfo is None:
                last_reset = last_reset.replace(tzinfo=timezone.utc)
            time_since_last = datetime.now(timezone.utc) - last_reset
            if time_since_last < timedelta(hours=1):
                return jsonify({"msg": "Please wait before requesting another password reset"}), 429
        except (ValueError, AttributeError):
            pass

    # Generate reset token
    reset_token = generate_reset_token()
    reset_token_expires = get_token_expiry(hours=1)

    # Update user with reset token
    users_collection.update_one(
        {"email": email},
        {
            "$set": {
                "password_reset_token": reset_token,
                "password_reset_token_expires": reset_token_expires
            }
        }
    )

    # Send password reset email
    email_sent = send_password_reset_email(email, reset_token)
    if not email_sent:
        return jsonify({"msg": "Failed to send password reset email"}), 500

    return jsonify({"msg": "If an account exists, a password reset email has been sent"}), 200


def reset_password(bcrypt, request):
    """Reset password with reset token."""
    data = request.json
    token = string_field(data, "token")
    new_password = string_field(data, "new_password")

    if not token or not new_password:
        return jsonify({"msg": "Token and new password required"}), 400

    # Validate password strength
    if len(new_password) < 8:
        return jsonify({"msg": "Password must be at least 8 characters long"}), 400

    # Find user with matching token
    user_doc = users_collection.find_one({"password_reset_token": token})
    
    if not user_doc:
        return jsonify({"msg": "Invalid reset token"}), 400

    # Check if token has expired
    expires_at = user_doc.get("password_reset_token_expires")
    if not verify_token_expiry(expires_at):
        return jsonify({"msg": "Reset token has expired"}), 400

    # Hash new password
    hashed_password = bcrypt.generate_password_hash(new_password).decode('utf-8')

    # Update user password and clear reset token. A new login id signs out every session and
    # remember-me cookie issued before the reset.
    users_collection.update_one(
        {"email": user_doc["email"]},
        {
            "$set": {
                "password": hashed_password,
                "password_reset_token": None,
                "password_reset_token_expires": None,
                "login_id": _new_login_id(),
            }
        }
    )

    return jsonify({"msg": "Password reset successfully"}), 200


def request_otp(request):
    """Request OTP for passwordless login."""
    data = request.json
    email = normalized_email(string_field(data, "email"))

    if not email:
        return jsonify({"msg": "Email required"}), 400

    # Find user
    user_doc = users_collection.find_one({"email": email})
    
    if not user_doc:
        # Don't reveal if user exists for security
        return jsonify({"msg": "If an account exists for that address, a sign-in code has been sent to it."}), 200

    # Check if email is verified
    if not user_doc.get("email_verified", False):
        return jsonify({"msg": SIGN_IN_VERIFY_FIRST}), 403

    # One code at a time: refused until an hour after the last code expired, unless it was used or
    # five wrong tries discarded it, either of which clears its expiry.
    last_otp_time = user_doc.get("otp_expires")
    if last_otp_time:
        try:
            last_otp = datetime.fromisoformat(last_otp_time.replace('Z', '+00:00'))
            if last_otp.tzinfo is None:
                last_otp = last_otp.replace(tzinfo=timezone.utc)
            time_since_last = datetime.now(timezone.utc) - last_otp
            if time_since_last < timedelta(hours=1):
                return jsonify({"msg": "Please wait a moment before asking for another code."}), 429
        except (ValueError, AttributeError):
            pass

    # Generate OTP
    otp = generate_otp()
    otp_expires = get_otp_expiry(minutes=5)

    # Update user with OTP
    users_collection.update_one(
        {"email": email},
        {
            "$set": {
                "otp": otp,
                "otp_expires": otp_expires,
                "otp_attempts": 0
            }
        }
    )

    # Send OTP email
    email_sent = send_otp_email(email, otp)
    if not email_sent:
        return jsonify({"msg": "The sign-in code could not be sent. Please try again."}), 500

    return jsonify({"msg": "If an account exists for that address, a sign-in code has been sent to it."}), 200


def login_with_otp(login_user, request):
    """Login with OTP code."""
    data = request.json
    email = normalized_email(string_field(data, "email"))
    otp = string_field(data, "otp")

    if not email or not otp:
        return jsonify({"msg": "Enter your email address and the code."}), 400

    # Find user
    user_doc = users_collection.find_one({"email": email})
    
    if not user_doc:
        return jsonify({"msg": SIGN_IN_WRONG_CODE}), 401

    # Check if OTP exists and matches
    stored_otp = user_doc.get("otp")
    if not stored_otp or stored_otp != otp:
        # Increment attempts
        attempts = user_doc.get("otp_attempts", 0) + 1
        users_collection.update_one(
            {"email": email},
            {"$set": {"otp_attempts": attempts}}
        )
        
        if attempts >= 5:
            # Clear OTP after max attempts
            users_collection.update_one(
                {"email": email},
                {"$set": {"otp": None, "otp_expires": None, "otp_attempts": 0}}
            )
            return jsonify({"msg": "Too many wrong codes. Ask for a new one."}), 429
        
        return jsonify({"msg": SIGN_IN_WRONG_CODE}), 401

    # Check if OTP has expired
    expires_at = user_doc.get("otp_expires")
    if not verify_token_expiry(expires_at):
        return jsonify({"msg": "That code has expired. Ask for a new one."}), 400

    # Check if email is verified
    if not user_doc.get("email_verified", False):
        return jsonify({"msg": SIGN_IN_VERIFY_FIRST}), 403

    # Clear OTP and attempts
    users_collection.update_one(
        {"email": email},
        {
            "$set": {
                "otp": None,
                "otp_expires": None,
                "otp_attempts": 0
            }
        }
    )

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


def delete_user(request, authenticated_email: str):
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
    """
    data = request.json or {}
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

    user_id_to_delete = user_to_delete.get("id")

    owned_orgs = (
        list(organizations_collection.find({"owner": user_id_to_delete}))
        if user_id_to_delete
        else []
    )
    if owned_orgs:
        org_names = [org.get("name") for org in owned_orgs]
        return jsonify({
            "msg": (
                "Transfer ownership of "
                f"{', '.join(org_names)} before deleting this account."
            ),
            "ownedOrganizations": org_names,
        }), 409

    result = users_collection.delete_one({"email": email_to_delete})

    if result.deleted_count > 0:
        # Membership elsewhere is not ownership, so it is safe to drop on the way out.
        if user_id_to_delete:
            organizations_collection.update_many(
                {},
                {"$pull": {"members": user_id_to_delete, "admins": user_id_to_delete}}
            )
        return jsonify({"msg": "User deleted successfully"}), 200

    return jsonify({"msg": "Failed to delete user"}), 500
