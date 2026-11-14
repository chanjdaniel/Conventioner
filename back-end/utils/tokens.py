"""
Token and OTP generation utilities for email verification, password reset, and passwordless login.
"""

import secrets
import string


def generate_verification_token() -> str:
    """Generate a secure random token for email verification (32 characters)."""
    return secrets.token_urlsafe(24)


def generate_reset_token() -> str:
    """Generate a secure random token for password reset (32 characters)."""
    return secrets.token_urlsafe(24)


def generate_otp() -> str:
    """Generate a 6-digit numeric OTP for passwordless login."""
    return ''.join(secrets.choice(string.digits) for _ in range(6))
