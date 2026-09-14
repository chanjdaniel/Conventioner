#!/usr/bin/env python3
"""Rewrite stored `submitted_at` values that are not ISO-8601.

Why this exists (E01/F04/S02, wayfinder ticket 01): the CSV import used to store the timestamp
exactly as the form wrote it - `9/12/2025 18:22:56`. Two readers compare that stored value and both
were wrong on it:

  - the solver's priority rule, through ``_as_magnitude`` -> ``datetime.fromisoformat``, which
    cannot parse it, so every imported vendor scored ``math.inf`` and "earliest first" ordered
    nothing at all;
  - the organizer's review queue, through a Mongo sort on the raw string, where an unpadded hour
    puts `9/27/2025 9:04:01` after `9/27/2025 23:49:25`.

The import normalises at the boundary now. This brings already-imported applications into the same
shape so those two readers are right about them too.

**No boot marker, deliberately.** The marker pattern (``migrate_market_keys.py``) exists for a
hazard that is *invisible* - an unmigrated market simply does not appear anywhere, with nothing
logged. A raw timestamp misorders in plain sight. Making the app refuse to boot over a loud failure
teaches operators that the refusal is noise, which is the one thing the market-keys check must not
become.

Safe to run repeatedly: a value that is already ISO is left untouched.

Usage:
    docker compose run --rm backend python migrations/migrate_submitted_at_to_iso.py [--dry-run]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from csv_import import normalized_submitted_at  # noqa: E402
from db_config import get_database  # noqa: E402


def migrate(dry_run: bool = False) -> int:
    """Returns the number of documents that needed rewriting."""
    db = get_database()
    applications = db["applications"]

    changed = unreadable = 0
    for doc in applications.find({"submitted_at": {"$nin": [None, ""]}}):
        raw = doc.get("submitted_at")
        try:
            iso = normalized_submitted_at(raw)
        except ValueError:
            # Left exactly as it is. A value nobody can read is not one this script should guess
            # at, and it is now visible: the row is named rather than silently sorting last.
            unreadable += 1
            print(f"  ? {doc.get('applicant_email', doc.get('id'))}: cannot read {raw!r}, left alone")
            continue

        if iso == raw:
            continue

        changed += 1
        print(f"  - {doc.get('applicant_email', doc.get('id'))}: {raw!r} -> {iso!r}")
        if not dry_run:
            applications.update_one({"_id": doc["_id"]}, {"$set": {"submitted_at": iso}})

    verb = "would rewrite" if dry_run else "rewrote"
    print(f"\n{verb} {changed} application(s).")
    if unreadable:
        print(f"{unreadable} left alone because their timestamp could not be read.")
    return changed


if __name__ == "__main__":
    raise SystemExit(0 if migrate(dry_run="--dry-run" in sys.argv) >= 0 else 1)
