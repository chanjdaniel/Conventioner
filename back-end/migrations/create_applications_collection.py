#!/usr/bin/env python3
"""One-time migration: create the ``applications`` collection and its ``market_id`` index.

``mongo-init.js`` only runs against a fresh Mongo data volume, so an already-deployed database
never gets them. The D9 application-form lock counts applications by market on every market
write, and PR5 starts writing those documents -- without this index that count is a collection
scan in production.

Idempotent -- running it twice is harmless.

Usage:
    python migrations/create_applications_collection.py
    python migrations/create_applications_collection.py --dry-run
"""

import argparse
import os
import sys

# Add parent directory to path to import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.applications import APPLICATIONS_COLLECTION, MARKET_ID_FIELD
from db_config import get_database


def migrate(db, dry_run=False):
    collection_exists = APPLICATIONS_COLLECTION in db.list_collection_names()

    if dry_run:
        if collection_exists:
            print(f"[DRY RUN] collection '{APPLICATIONS_COLLECTION}' already exists")
        else:
            print(f"[DRY RUN] would create collection '{APPLICATIONS_COLLECTION}'")
        print(
            f"[DRY RUN] would ensure index on "
            f"{APPLICATIONS_COLLECTION}.{MARKET_ID_FIELD}"
        )
        return

    if collection_exists:
        print(f"Collection '{APPLICATIONS_COLLECTION}' already exists")
    else:
        db.create_collection(APPLICATIONS_COLLECTION)
        print(f"Created collection '{APPLICATIONS_COLLECTION}'")

    index_name = db[APPLICATIONS_COLLECTION].create_index([(MARKET_ID_FIELD, 1)])
    print(f"Ensured index '{index_name}' on {APPLICATIONS_COLLECTION}.{MARKET_ID_FIELD}")


def main():
    parser = argparse.ArgumentParser(
        description="Create the applications collection and its market_id index"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    args = parser.parse_args()

    db = get_database()
    migrate(db, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
