"""A person's address, the one way it is stored and compared (E32/F03/S04).

Lowercased and trimmed, wherever an address is stored or matched: an organizer's account (what is
typed at register, sign-in, a code or a reset, and what an operator script stores), an applicant's
sign-in, a vendor's check-in, notes, table share and placement trail. Two spellings of one
address used to be two accounts, and an account registered with a capital letter could only sign in
spelled exactly so. ``users.email`` is unique over this form (``api.users.ensure_user_indexes``).
"""
from typing import Any


def normalized_email(raw: Any) -> str:
    """An address as stored: trimmed and lowercased; empty for none."""
    return str(raw or "").strip().lower()
