import uuid
from typing import Optional
from flask import request, jsonify
from flask_login import UserMixin
from datatypes import User
from db_config import get_database
from utils.tokens import (
    generate_verification_token, generate_reset_token, generate_otp,
    get_token_expiry, get_otp_expiry, verify_token_expiry
)
from utils.email import send_verification_email, send_password_reset_email, send_otp_email
from utils.captcha import verify_recaptcha
from datetime import datetime, timedelta

db = get_database()
users_collection = db["users"]

# users
class AuthUser(UserMixin):
    def __init__(self, user: User):
        self.id = user.id
        self.email = user.email
        self.organizations = user.organizations

    def get_id(self):
        return self.email

def get_user(email):
    """Load user from MongoDB using email as the key"""
    user_doc = users_collection.find_one({"email": email})
    if user_doc:
        # Remove MongoDB's _id field before creating User object
        user_doc.pop('_id', None)
        return AuthUser(User(**user_doc))
    return None

# curl -k -X POST https://127.0.0.1:5000/register-user \
#      -H "Content-Type: application/json" \
#      -d '{"email": "USERNAME", "password": "pswrdpswrd!!!", "organizations": []}'
def register_user(bcrypt, request):
    data = request.json
    email = data.get("email")
    password = data.get("password")
    organizations = data.get("organizations", [])

    if not email or not password:
        return jsonify({"msg": "Email and password required"}), 400

    # Check if user already exists in MongoDB
    existing_user = users_collection.find_one({"email": email})
    if existing_user:
        return jsonify({"msg": "User already exists"}), 400

    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password": hashed_password,
        "organizations": organizations
    }
    
    # Insert user into MongoDB
    result = users_collection.insert_one(user_doc)
    
    if result.inserted_id:
        return jsonify({"msg": "User registered successfully"}), 201
    else:
        return jsonify({"msg": "Failed to register user"}), 500

def login(bcrypt, login_user, request):
    data = request.json
    email, password = data.get('email'), data.get('password')

    # Find user in MongoDB
    user_doc = users_collection.find_one({"email": email})
    if user_doc and bcrypt.check_password_hash(user_doc["password"], password):
        # Check if email is verified
        if not user_doc.get("email_verified", False):
            return jsonify({"message": "Please verify your email before logging in"}), 403
        
        # Remove MongoDB's _id field before creating User object
        user_doc.pop('_id', None)
        auth_user = AuthUser(User(**user_doc))
        login_user(auth_user, remember=True)

        user_data = {
            "id": auth_user.id,
            "email": auth_user.email,
            "organizations": auth_user.organizations
        }
        return jsonify({"message": "Login successful", "user_data": user_data}), 200

    return jsonify({"message": "Invalid credentials"}), 401

def logout(logout_user):
    logout_user()
    return jsonify({"message": "Logged out"}), 200

def check_session(current_user):
    return jsonify({"email": current_user.email}), 200


def register_user_with_captcha(bcrypt, request):
    """Register a new user with CAPTCHA verification."""
    data = request.json
    email = data.get("email")
    password = data.get("password")
    captcha_token = data.get("captcha_token")
    organizations = data.get("organizations", [])

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
        return jsonify({"msg": "User already exists"}), 400

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
        "organizations": organizations,
        "email_verified": False,
        "verification_token": verification_token,
        "verification_token_expires": verification_token_expires,
        "password_reset_token": None,
        "password_reset_token_expires": None,
        "otp": None,
        "otp_expires": None,
        "otp_attempts": 0
    }
    
    # Insert user into MongoDB
    result = users_collection.insert_one(user_doc)
    
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
    token = data.get("token")

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
    email = data.get("email")

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
    email = data.get("email")

    if not email:
        return jsonify({"msg": "Email required"}), 400

    # Find user
    user_doc = users_collection.find_one({"email": email})
    
    if not user_doc:
        # Don't reveal if user exists for security
        return jsonify({"msg": "If an account exists, a password reset email has been sent"}), 200

    # Check rate limiting (max 3 requests per hour)
    last_reset_time = user_doc.get("password_reset_token_expires")
    if last_reset_time:
        try:
            last_reset = datetime.fromisoformat(last_reset_time.replace('Z', '+00:00'))
            time_since_last = datetime.utcnow() - last_reset
            if time_since_last < timedelta(hours=1):
                # Check how many requests in the last hour
                # Simple check: if token exists and is recent, rate limit
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
    token = data.get("token")
    new_password = data.get("new_password")

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

    # Update user password and clear reset token
    users_collection.update_one(
        {"email": user_doc["email"]},
        {
            "$set": {
                "password": hashed_password,
                "password_reset_token": None,
                "password_reset_token_expires": None
            }
        }
    )

    return jsonify({"msg": "Password reset successfully"}), 200


def request_otp(request):
    """Request OTP for passwordless login."""
    data = request.json
    email = data.get("email")

    if not email:
        return jsonify({"msg": "Email required"}), 400

    # Find user
    user_doc = users_collection.find_one({"email": email})
    
    if not user_doc:
        # Don't reveal if user exists for security
        return jsonify({"msg": "If an account exists, an OTP has been sent"}), 200

    # Check if email is verified
    if not user_doc.get("email_verified", False):
        return jsonify({"msg": "Please verify your email before using passwordless login"}), 403

    # Check rate limiting (max 3 requests per hour)
    last_otp_time = user_doc.get("otp_expires")
    if last_otp_time:
        try:
            last_otp = datetime.fromisoformat(last_otp_time.replace('Z', '+00:00'))
            time_since_last = datetime.utcnow() - last_otp
            if time_since_last < timedelta(hours=1):
                # Count requests in last hour (simple check)
                return jsonify({"msg": "Please wait before requesting another OTP"}), 429
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
        return jsonify({"msg": "Failed to send OTP email"}), 500

    return jsonify({"msg": "If an account exists, an OTP has been sent"}), 200


def login_with_otp(login_user, request):
    """Login with OTP code."""
    data = request.json
    email = data.get("email")
    otp = data.get("otp")

    if not email or not otp:
        return jsonify({"msg": "Email and OTP required"}), 400

    # Find user
    user_doc = users_collection.find_one({"email": email})
    
    if not user_doc:
        return jsonify({"msg": "Invalid credentials"}), 401

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
            return jsonify({"msg": "Too many failed attempts. Please request a new OTP"}), 429
        
        return jsonify({"msg": "Invalid OTP"}), 401

    # Check if OTP has expired
    expires_at = user_doc.get("otp_expires")
    if not verify_token_expiry(expires_at):
        return jsonify({"msg": "OTP has expired"}), 400

    # Check if email is verified
    if not user_doc.get("email_verified", False):
        return jsonify({"msg": "Please verify your email before logging in"}), 403

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

    # Create auth user and login
    user_doc.pop('_id', None)
    auth_user = AuthUser(User(**user_doc))
    login_user(auth_user, remember=True)

    user_data = {
        "id": auth_user.id,
        "email": auth_user.email,
        "organizations": auth_user.organizations
    }
    return jsonify({"message": "Login successful", "user_data": user_data}), 200


def get_user_by_id(user_id: str):
    """Load user from MongoDB using id."""
    user_doc = users_collection.find_one({"id": user_id})
    if user_doc:
        user_doc.pop('_id', None)
        return AuthUser(User(**user_doc))
    return None


def get_user_raw(email: str) -> Optional[dict]:
    """Get raw user dict by email (for internal use)."""
    user_doc = users_collection.find_one({"email": email})
    if user_doc:
        user_doc.pop('_id', None)
        return user_doc
    return None


def delete_user(request, requesting_user_email: str = None):
    """Delete a user account.
    
    Args:
        request: Flask request object
        requesting_user_email: Email of the user making the request (None for unauthenticated)
        
    Returns:
        JSON response with deletion status
    """
    data = request.json or {}
    email_to_delete = data.get("email")
    
    if not email_to_delete:
        return jsonify({"msg": "Email address required"}), 400
    
    # Find the user to delete
    user_to_delete = users_collection.find_one({"email": email_to_delete})
    
    if not user_to_delete:
        return jsonify({"msg": "User not found"}), 404
    
    # Security: Users can only delete their own account, or unverified accounts can be deleted by anyone
    # (This allows cleanup of orphaned unverified accounts)
    is_own_account = requesting_user_email and email_to_delete == requesting_user_email
    is_unverified = not user_to_delete.get("email_verified", False)
    
    if not is_own_account and not is_unverified:
        return jsonify({"msg": "You can only delete your own account or unverified accounts"}), 403
    
    # Delete the user
    result = users_collection.delete_one({"email": email_to_delete})
    
    if result.deleted_count > 0:
        # Also remove user from any organizations they belonged to (owner/admins/members are now user ids)
        from api.organizations import organizations_collection
        user_id_to_delete = user_to_delete.get("id")
        if user_id_to_delete:
            organizations_collection.update_many(
                {},
                {"$pull": {"members": user_id_to_delete, "admins": user_id_to_delete}}
            )
        
        # Note: We don't transfer ownership here - that should be done manually
        # Check if user was owner of any organizations (owner is now user id)
        owned_orgs = list(organizations_collection.find({"owner": user_id_to_delete})) if user_id_to_delete else []
        if owned_orgs:
            org_names = [org.get("name") for org in owned_orgs]
            return jsonify({
                "msg": f"User deleted. Warning: User was owner of organizations: {', '.join(org_names)}. Please transfer ownership manually.",
                "warning": True,
                "owned_organizations": org_names
            }), 200
        
        return jsonify({"msg": "User deleted successfully"}), 200
    else:
        return jsonify({"msg": "Failed to delete user"}), 500