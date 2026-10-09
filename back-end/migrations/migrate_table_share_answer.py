#!/usr/bin/env python3
"""Bring stored table-share answers into the shape the write stores now (E27/F01/S01).

The question asks for "the exact email address they submitted", and real answers wrap the address
in a sentence or type it in other case. It used to be stored as typed under
``essential_table_share_email``, and the solver compared that text with applicants' addresses, so
those answers paired nobody. The write now reads the address out of the answer
(``essential_fields.partner_address``) and keeps the words beside it, under
``essential_table_share_answer``.

The answer is solver-relevant, so an application left in the old shape would read as changed on
the next import of an unchanged file, and an approved vendor would go back to review for nothing.
This rewrites each one exactly as the write would have stored it.

**No boot marker**, for the reason ``migrate_submitted_at_to_iso.py`` gives: an unmigrated answer
fails visibly (the organizer is shown a request that pairs nobody), not invisibly.

Safe to run repeatedly: an application that already holds the words is left alone.

Usage:
    docker compose run --rm backend python migrations/migrate_table_share_answer.py [--dry-run]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from essential_fields import (  # noqa: E402
    TABLE_SHARE_ANSWER_KEY, TABLE_SHARE_EMAIL_KEY, table_share_answers,
)


def migrate(db=None, dry_run: bool = False) -> int:
    """Returns the number of applications that needed rewriting."""
    if db is None:
        from db_config import get_database
        db = get_database()
    applications = db.applications

    changed = 0
    for doc in applications.find({
        f"form_data.{TABLE_SHARE_EMAIL_KEY}": {"$exists": True},
        f"form_data.{TABLE_SHARE_ANSWER_KEY}": {"$exists": False},
    }):
        rewritten = table_share_answers(doc["form_data"].get(TABLE_SHARE_EMAIL_KEY))
        changed += 1
        # The id, never the address: this prints to an operator's terminal.
        found = "found" if rewritten[TABLE_SHARE_EMAIL_KEY] else "none"
        print(f"  - application {doc.get('id')}: partner {found}")
        if not dry_run:
            applications.update_one({"_id": doc["_id"]}, {"$set": {
                f"form_data.{key}": value for key, value in rewritten.items()
            }})

    verb = "would rewrite" if dry_run else "rewrote"
    print(f"\n{verb} {changed} application(s).")
    return changed


if __name__ == "__main__":
    raise SystemExit(0 if migrate(dry_run="--dry-run" in sys.argv) >= 0 else 1)
