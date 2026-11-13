"""The records of an account's sign-in secrets as ``account_secrets`` keeps them, for a test to
plant on a fake account, standing for a secret already mailed."""
from datetime import datetime, timedelta, timezone
from typing import Optional

import account_secrets


def live_code(code: str, expires_at: Optional[datetime] = None, tries: int = 0) -> dict:
    """A mailed code: live, kept salted and hashed, its wait running from its expiry.
    ``expires_at`` defaults to a code mailed now."""
    if expires_at is None:
        expires_at = datetime.now(timezone.utc) + account_secrets.CODE_LIFE
    return {
        "hash": account_secrets.hash_code(code),
        "expires_at": expires_at,
        "next_allowed_at": expires_at + account_secrets.CODE_WAIT,
        "tries": tries,
        "state": account_secrets.LIVE,
    }


def live_link(link: str, expires_at: Optional[datetime] = None) -> dict:
    """A mailed reset link: live, kept as its SHA-256, its wait running from its expiry.
    ``expires_at`` defaults to a link mailed now."""
    if expires_at is None:
        expires_at = datetime.now(timezone.utc) + account_secrets.RESET_LIFE
    return {
        "hash": account_secrets.hash_link(link),
        "expires_at": expires_at,
        "next_allowed_at": expires_at + account_secrets.RESET_WAIT,
        "tries": 0,
        "state": account_secrets.LIVE,
    }


def stored_code(account: dict) -> Optional[dict]:
    """The code record an account holds, or None."""
    return (account.get("secrets") or {}).get("code")


def stored_link(account: dict) -> Optional[dict]:
    """The reset link record an account holds, or None."""
    return (account.get("secrets") or {}).get("reset")
