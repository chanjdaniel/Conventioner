#!/usr/bin/env python3
"""One-time migration: rewrite market documents under the canonical camelCase keys.

Idempotent -- running it twice is harmless.

Markets are persisted camel-cased (``convert_keys_to_camel_case`` in ``create_market`` and
``update_market``), but documents written before that convention carry snake_case keys, and a
later write only ever adds the camelCase spelling alongside them. A document holding both
keeps a stale ``organization_id`` (or ``is_draft``) forever, so any query that still matches
the legacy spelling acts on data no write has refreshed since. This drops the legacy keys, so
every market names each field exactly once and readers can name one key.

Where a document carries both spellings, the camelCase value wins -- it is the one the last
write set.

The run records a marker in the ``schema_migrations`` collection. The app refuses to boot
without it, because reads that name the canonical key only would silently hide any market this
migration has not reached. Run this before deploying, and note that nothing runs it for you.

Usage:
    python migrations/migrate_market_keys.py
    python migrations/migrate_market_keys.py --dry-run
"""

import argparse
import os
import sys

# Add parent directory to path to import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db_config import get_database
from market_documents import (
    MARKET_KEY_MIGRATION_ID,
    SCHEMA_COLLECTION,
    apply_market_key_migration,
    pending_market_key_rewrites,
)


def legacy_keys(doc, normalized):
    """Top-level keys of the document that are not the canonical spelling of their field."""
    return sorted(key for key in doc if key not in normalized)


def migrate(db, dry_run=False):
    if dry_run:
        pending = pending_market_key_rewrites(db)
        for doc, normalized in pending:
            dropped = legacy_keys(doc, normalized)
            print(
                f"[DRY RUN] market {doc.get('id')}: rewrite under canonical keys"
                + (f" (drop {', '.join(dropped)})" if dropped else "")
            )
        print(f"\nDRY RUN: would rewrite {len(pending)} market(s)")
        print(f"DRY RUN: would record '{MARKET_KEY_MIGRATION_ID}' in '{SCHEMA_COLLECTION}'")
        return

    rewritten = apply_market_key_migration(db)

    print(f"Rewrote {rewritten} market(s)")
    if not rewritten:
        print("No markets with legacy keys found -- documents were already canonical.")
    print(f"Recorded '{MARKET_KEY_MIGRATION_ID}' in '{SCHEMA_COLLECTION}' -- the app will boot.")


def main():
    parser = argparse.ArgumentParser(
        description="Rewrite market documents under the canonical camelCase keys"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    args = parser.parse_args()

    db = get_database()
    migrate(db, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
