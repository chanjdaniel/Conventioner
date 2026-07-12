#!/usr/bin/env python3
"""One-time migration: add ``phase`` field to existing market documents.

Idempotent -- running it twice is harmless.

Mapping:
    is_draft: true  -> phase: "draft"
    is_draft: false -> phase: "archived"  (safe default per D7 read-only archives)

Usage:
    python migrations/migrate_phase.py
    python migrations/migrate_phase.py --dry-run
"""

import argparse
import os
import sys

# Add parent directory to path to import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datatypes import MarketPhase
from db_config import get_database


def read_is_draft(doc):
    """Market documents are persisted camel-cased (``isDraft``); older ones use ``is_draft``."""
    if "isDraft" in doc:
        return bool(doc["isDraft"])
    return bool(doc.get("is_draft", True))


def target_phase(doc):
    return MarketPhase.DRAFT.value if read_is_draft(doc) else MarketPhase.ARCHIVED.value


def migrate(db, dry_run=False):
    collection = db.markets
    pending = list(collection.find({"phase": {"$exists": False}}))

    if dry_run:
        for doc in pending:
            print(
                f"[DRY RUN] market {doc.get('id')}: "
                f"is_draft={read_is_draft(doc)} -> phase={target_phase(doc)}"
            )
        print(f"\nDRY RUN: would update {len(pending)} market(s)")
        return

    ids_by_phase = {}
    for doc in pending:
        ids_by_phase.setdefault(target_phase(doc), []).append(doc["_id"])

    updated = 0
    for phase, ids in ids_by_phase.items():
        result = collection.update_many({"_id": {"$in": ids}}, {"$set": {"phase": phase}})
        updated += result.modified_count

    print(f"Updated {updated} market(s) (scanned {len(pending)})")
    if not pending:
        print("No markets without a phase field found -- migration already applied.")


def main():
    parser = argparse.ArgumentParser(description="Add phase field to existing market documents")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    args = parser.parse_args()

    db = get_database()
    migrate(db, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
