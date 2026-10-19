"""An organizer's address, the one way it is stored and looked up (E32/F03/S04).

Lowercased and trimmed, everywhere an address meets the users collection: what is typed at
register, sign-in, a code or a reset, and what an operator script stores. Two spellings of one
address used to be two accounts, and an account registered with a capital letter could only sign in
spelled exactly so. ``users.email`` is unique over this form (``api.users.ensure_user_indexes``).
"""
from typing import Optional


def normalized_email(raw: Optional[str]) -> str:
    """An address as stored: trimmed and lowercased; empty for none."""
    return (raw or "").strip().lower()
