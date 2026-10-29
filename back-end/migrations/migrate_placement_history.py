#!/usr/bin/env python3
"""Move the placement history into the market's history (E40/F01/S01).

The ``placement_history`` collection became ``history``, which records every change on a market
(``history.py``, ADR 0017). Each entry moves with every field it had - its ``_id``, id, market,
actor, time, kind, vendors and detail - and gains the two fields the wider history adds: its action
(``assign``, the ``E39`` action a placement is) and its subject (the table-day it is about, as
``history.placement_subject`` reads it from the detail). The old collection is dropped once empty.

Run it after the release that carries ``history.py`` is deployed, ``--dry-run`` first, whenever is
convenient: that release reads ``placement_history`` beside ``history`` until a later one removes the
fallback, so the drawer's History tab answers as before either side of it. Safe to run repeatedly:
an entry is written by its ``_id`` before it leaves the old collection, so a second run, or one
after a run that stopped part-way, moves only what is left and doubles nothing.

Usage (the production database address passed inline, never from back-end/.env):
    MONGODB_URI='<URI>' python migrations/migrate_placement_history.py [--dry-run]
"""
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def migrate_placement_history(db: Any, dry_run: bool = False) -> int:
    """Returns how many entries moved, or would move on a dry run."""
    from api.market_actions import ASSIGN
    from history import HISTORY_COLLECTION, LEGACY_PLACEMENT_COLLECTION, placement_subject

    old = db[LEGACY_PLACEMENT_COLLECTION]
    entries = list(old.find({}))
    if dry_run or not entries:
        return len(entries)

    history = db[HISTORY_COLLECTION]
    for entry in entries:
        history.replace_one(
            {"_id": entry["_id"]},
            {
                **entry,
                "action": ASSIGN.id,
                "subject": placement_subject(entry.get("kind"), entry.get("detail") or {}),
            },
            upsert=True,
        )
    old.delete_many({"_id": {"$in": [entry["_id"] for entry in entries]}})
    if old.count_documents({}) == 0:
        old.drop()
    return len(entries)


def main() -> int:
    from db_config import get_database

    dry_run = "--dry-run" in sys.argv[1:]
    moved = migrate_placement_history(get_database(), dry_run=dry_run)
    verb = "would move" if dry_run else "moved"
    entries = "entry" if moved == 1 else "entries"
    print(f"✅ {moved} placement history {entries} {verb} into the history.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
