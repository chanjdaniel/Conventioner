#!/usr/bin/env python3
"""One-time migration: rewrite market documents into canonical form.

Idempotent -- running it twice is harmless, and a database an older build already migrated only
needs running again to pick up the slug.

Canonical form is two things, and both are here because both are repaired by the same rewrite.

**Canonical keys.** Markets are persisted camel-cased (``convert_keys_to_camel_case`` in
``create_market`` and ``update_market``), but documents written before that convention carry
snake_case keys, and a later write only ever adds the camelCase spelling alongside them. A
document holding both keeps a stale ``organization_id`` (or ``is_draft``) forever, so any query
that still matches the legacy spelling acts on data no write has refreshed since. This drops the
legacy keys, so every market names each field exactly once and readers can name one key. Where a
document carries both spellings, the camelCase value wins -- it is the one the last write set.

**A stored slug.** Every public URL a market appears on names it by the slug of its name, and the
lookup behind those URLs is unauthenticated. It queries the stored slug, which is indexed, so that
a stranger cannot drive a decode of every market in the database by typing a URL. New markets get
one from ``Market.slug``; this stamps it on the ones written before that field existed, and builds
the index. A market without one is reachable at no public URL at all.

The run records a marker per part in the ``schema_migrations`` collection. The app refuses to boot
without both, because a market this migration has not reached is one that reads silently cannot
see. Run this before deploying, and note that nothing runs it for you.

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
    MARKET_MIGRATION_IDS,
    MARKET_SLUG_INDEX,
    SCHEMA_COLLECTION,
    apply_market_key_migration,
    pending_market_key_rewrites,
)


def legacy_keys(doc, normalized):
    """Top-level keys of the document that are not the canonical spelling of their field."""
    return sorted(key for key in doc if key not in normalized)


def added_keys(doc, normalized):
    """Canonical keys the rewrite adds that the stored document does not have -- the slug."""
    return sorted(key for key in normalized if key not in doc)


def migrate(db, dry_run=False):
    markers = ", ".join(repr(marker) for marker in MARKET_MIGRATION_IDS)
    if dry_run:
        pending = pending_market_key_rewrites(db)
        for doc, normalized in pending:
            dropped = legacy_keys(doc, normalized)
            added = added_keys(doc, normalized)
            print(
                f"[DRY RUN] market {doc.get('id')}: rewrite into canonical form"
                + (f" (drop {', '.join(dropped)})" if dropped else "")
                + (f" (add {', '.join(added)})" if added else "")
            )
        print(f"\nDRY RUN: would rewrite {len(pending)} market(s)")
        print(f"DRY RUN: would build the '{MARKET_SLUG_INDEX}' index")
        print(f"DRY RUN: would record {markers} in '{SCHEMA_COLLECTION}'")
        return

    rewritten = apply_market_key_migration(db)

    print(f"Rewrote {rewritten} market(s)")
    if not rewritten:
        print("Nothing to rewrite -- every market document was already canonical.")
    print(f"Built the '{MARKET_SLUG_INDEX}' index on the markets collection")
    print(f"Recorded {markers} in '{SCHEMA_COLLECTION}' -- the app will boot.")


def main():
    parser = argparse.ArgumentParser(
        description="Rewrite market documents into canonical form (camelCase keys, stored slug)"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    args = parser.parse_args()

    db = get_database()
    migrate(db, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
