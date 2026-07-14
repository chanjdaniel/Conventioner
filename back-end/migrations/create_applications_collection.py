#!/usr/bin/env python3
"""One-time migration: create the ``applications`` collection and its indexes.

``mongo-init.js`` only runs against a fresh Mongo data volume, so an already-deployed database
never gets them. The D9 application-form lock counts applications by market on every market
write, and PR5 starts writing those documents -- without the ``market_id`` index that count is a
collection scan in production.

The second index is the applicant's identity: (``market_id``, ``applicant_email``,
``application_type``) is unique, because the public request-key endpoint reads before it inserts and
nothing but the database can stop two concurrent requests for one address from leaving two
applications on the organizer's list. See ``api.applications.ensure_application_indexes``.

A database that already holds such a duplicate cannot take the index, and the migration says which
documents they are rather than failing with a key nobody can read: the duplicates have to be merged
by hand, because only the organizer knows which of the two applications is the applicant's.

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

from api.applications import (
    APPLICANT_EMAIL_FIELD,
    APPLICANT_IDENTITY_INDEX,
    APPLICATION_TYPE_FIELD,
    APPLICATIONS_COLLECTION,
    MARKET_ID_FIELD,
)
from db_config import get_database

IDENTITY_KEYS = [(MARKET_ID_FIELD, 1), (APPLICANT_EMAIL_FIELD, 1), (APPLICATION_TYPE_FIELD, 1)]


class DuplicateApplicantsError(RuntimeError):
    """Two applications share one applicant identity, so the unique index cannot be built."""


def duplicate_applicants(collection):
    """The (market, email, type) groups that hold more than one application document."""
    return list(collection.aggregate([
        {"$group": {
            "_id": {field: f"${field}" for field, _direction in IDENTITY_KEYS},
            "ids": {"$push": "$id"},
            "count": {"$sum": 1},
        }},
        {"$match": {"count": {"$gt": 1}}},
    ]))


def _describe(duplicates) -> str:
    lines = [
        f"{len(duplicates)} applicant(s) hold more than one application, so the unique index "
        f"{APPLICANT_IDENTITY_INDEX} cannot be built. Merge each group by hand -- which of the "
        f"documents is the applicant's is the organizer's call, not this script's -- and run the "
        f"migration again:",
    ]
    for group in duplicates:
        identity = group["_id"]
        lines.append(
            f"  {identity.get(MARKET_ID_FIELD)} / {identity.get(APPLICANT_EMAIL_FIELD)} "
            f"/ {identity.get(APPLICATION_TYPE_FIELD)}: {group['count']} documents "
            f"({', '.join(str(app_id) for app_id in group['ids'])})"
        )
    return "\n".join(lines)


def migrate(db, dry_run=False):
    collection_exists = APPLICATIONS_COLLECTION in db.list_collection_names()

    duplicates = duplicate_applicants(db[APPLICATIONS_COLLECTION]) if collection_exists else []

    if dry_run:
        if collection_exists:
            print(f"[DRY RUN] collection '{APPLICATIONS_COLLECTION}' already exists")
        else:
            print(f"[DRY RUN] would create collection '{APPLICATIONS_COLLECTION}'")
        print(
            f"[DRY RUN] would ensure index on "
            f"{APPLICATIONS_COLLECTION}.{MARKET_ID_FIELD}"
        )
        if duplicates:
            print(f"[DRY RUN] {_describe(duplicates)}")
        else:
            print(
                f"[DRY RUN] would ensure unique index '{APPLICANT_IDENTITY_INDEX}' on "
                f"{APPLICATIONS_COLLECTION}"
            )
        return

    if duplicates:
        raise DuplicateApplicantsError(_describe(duplicates))

    if collection_exists:
        print(f"Collection '{APPLICATIONS_COLLECTION}' already exists")
    else:
        db.create_collection(APPLICATIONS_COLLECTION)
        print(f"Created collection '{APPLICATIONS_COLLECTION}'")

    index_name = db[APPLICATIONS_COLLECTION].create_index([(MARKET_ID_FIELD, 1)])
    print(f"Ensured index '{index_name}' on {APPLICATIONS_COLLECTION}.{MARKET_ID_FIELD}")

    identity_index = db[APPLICATIONS_COLLECTION].create_index(
        IDENTITY_KEYS, unique=True, name=APPLICANT_IDENTITY_INDEX,
    )
    print(f"Ensured unique index '{identity_index}' on {APPLICATIONS_COLLECTION}")


def main():
    parser = argparse.ArgumentParser(
        description="Create the applications collection and its indexes"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    args = parser.parse_args()

    db = get_database()
    try:
        migrate(db, dry_run=args.dry_run)
    except DuplicateApplicantsError as exc:
        print(f"\n{exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
