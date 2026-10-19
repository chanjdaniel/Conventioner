#!/usr/bin/env python3
"""Store every account's address lowercased (E32/F03/S04).

`users.email` is unique over the lowercased address, so "Dan@x.com" and "dan@x.com" are one account
and a double click on Register cannot make two (`api.users.ensure_user_indexes`, which `app.py`
runs at boot). Register used to store an address as typed, so a database written before then may
hold capitals; the boot check refuses it, naming this script.

Rewrites each account whose stored address is not lowercased. When two accounts would share an
address, it writes nothing and names them by id: which account an organizer keeps is theirs to
decide, not a migration's. Merge or delete all but one, then run it again.

Safe to run repeatedly: an account already lowercased is left alone.

Usage (the production database address passed inline, never from back-end/.env):
    docker compose run --rm backend python migrations/migrate_user_emails.py [--dry-run]
"""
import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.email_address import normalized_email  # noqa: E402


class UserEmailCollisionError(RuntimeError):
    """Two or more accounts would share one address once lowercased."""

    def __init__(self, clashes: List[List[str]]) -> None:
        groups = "; ".join(", ".join(ids) for ids in clashes)
        super().__init__(
            f"{len(clashes)} address(es) belong to more than one account (account ids: {groups}). "
            "Nothing was written. Keep one account per address, then run this again."
        )
        self.clashes = clashes


def lowercase_user_emails(users: Any, dry_run: bool = False) -> int:
    """Returns how many accounts needed rewriting. Writes nothing if any would collide."""
    accounts = list(users.find({}, {"id": 1, "email": 1}))
    by_address: Dict[str, List[str]] = {}
    for account in accounts:
        by_address.setdefault(normalized_email(account.get("email")), []).append(
            str(account.get("id"))
        )
    clashes = [ids for ids in by_address.values() if len(ids) > 1]
    if clashes:
        raise UserEmailCollisionError(clashes)

    changed = 0
    for account in accounts:
        email = account.get("email") or ""
        if email == normalized_email(email):
            continue
        changed += 1
        # The id, never the address: this prints to an operator's terminal.
        print(f"  - account {account.get('id')}: address lowercased")
        if not dry_run:
            users.update_one({"id": account.get("id")}, {"$set": {"email": normalized_email(email)}})
    return changed


def main() -> int:
    from db_config import get_database

    dry_run = "--dry-run" in sys.argv[1:]
    try:
        changed = lowercase_user_emails(get_database()["users"], dry_run=dry_run)
    except UserEmailCollisionError as clash:
        print(f"❌ {clash}")
        return 1
    verb = "would be" if dry_run else "were"
    print(f"✅ {changed} account address(es) {verb} lowercased.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
