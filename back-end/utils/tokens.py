"""
Token and OTP generation utilities for email verification, password reset, and passwordless login.
"""

import secrets
import string
from datetime import datetime, timedelta, timezone


def generate_verification_token() -> str:
    """Generate a secure random token for email verification (32 characters)."""
    return secrets.token_urlsafe(24)


def generate_reset_token() -> str:
    """Generate a secure random token for password reset (32 characters)."""
    return secrets.token_urlsafe(24)


def generate_otp() -> str:
    """Generate a 6-digit numeric OTP for passwordless login."""
    return ''.join(secrets.choice(string.digits) for _ in range(6))


def get_token_expiry(hours: int = 1) -> str:
    """Get expiration timestamp for a token (default: 1 hour from now)."""
    expiry = datetime.now(timezone.utc) + timedelta(hours=hours)
    return expiry.isoformat()


def get_otp_expiry(minutes: int = 5) -> str:
    """Get expiration timestamp for an OTP (default: 5 minutes from now)."""
    expiry = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    return expiry.isoformat()


def verify_token_expiry(expires_at: str) -> bool:
    """Check if a token has expired.

    Args:
        expires_at: ISO format timestamp string

    Returns:
        True if token is still valid, False if expired
    """
    if not expires_at:
        return False

    try:
        expiry_time = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
        if expiry_time.tzinfo is None:
            expiry_time = expiry_time.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) < expiry_time
    except (ValueError, AttributeError):
        return False
