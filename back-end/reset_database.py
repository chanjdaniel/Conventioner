#!/usr/bin/env python3
"""
Script to reset the database by deleting all test data.

Wipes every application collection, leaving `schema_migrations` alone: its markers are a
boot requirement (see `migrations/migrate_market_keys.py`), and clearing them makes the back
end refuse to start.

This used to wipe organizations, markets and users only, and report "reset complete" while
leaving the applications, attendance records and floorplan images that referenced them. The
leftovers were orphans - their market ids pointed at documents that no longer existed - and
they outlived every reset, so a "clean" database still answered with 1,367 applications
belonging to nothing.

Usage:
    python reset_database.py
"""

import os

from db_config import get_database

# Every collection the application writes. `schema_migrations` is deliberately absent.
APP_COLLECTIONS = (
    'organizations',
    'markets',
    'users',
    'applications',
    'attendance',
    'applicant_login_challenges',
    'floorplan_templates',
    'source_data',
    # Missed until 2026-10-03, so every reset left the trail of who moved whom, and the record of
    # every deletion, pointing at markets and organizations that no longer existed.
    'placement_history',
    'deletion_trail',
    'vendor_notes',
)

# GridFS buckets, which are a pair of collections each and are not listed above.
GRIDFS_BUCKETS = ('floorplan_images',)

PRESERVED = ('schema_migrations',)


HOSTED_REFUSAL = (
    "Refusing to reset: MONGODB_URI is set, so this would erase a hosted database (production "
    "is reached that way). This script resets the local stack and CI, which use MONGODB_HOST. "
    "Unset MONGODB_URI to reset a local database; a hosted one is never reset by a script."
)


def reset_database():
    """Delete all documents from every application collection - of a LOCAL database only.

    Production is reached through MONGODB_URI and the local stack and CI through MONGODB_HOST, so
    a URI in the environment means this would erase a real market. It refuses, with no override:
    a hosted database is emptied, if ever, by hand in Atlas, not by a script typed in a hurry.
    """
    if os.getenv("MONGODB_URI"):
        raise SystemExit(HOSTED_REFUSAL)
    db = get_database()

    names = set(db.list_collection_names())
    targets = list(APP_COLLECTIONS)
    for bucket in GRIDFS_BUCKETS:
        targets += [f'{bucket}.files', f'{bucket}.chunks']

    for name in targets:
        result = db[name].delete_many({})
        print(f"  {name}: deleted {result.deleted_count} document(s)")

    # Anything the app has started writing since this list was last updated. Reported rather
    # than deleted: a collection nobody remembered is exactly the one worth looking at.
    unlisted = names - set(targets) - set(PRESERVED)
    if unlisted:
        print("\n  Not cleared, and not in this script's list:")
        for name in sorted(unlisted):
            print(f"    {name}: {db[name].count_documents({})} document(s) left in place")
        print("  Add them to APP_COLLECTIONS if they are application data.")

    print("\n✅ Database reset complete")


if __name__ == "__main__":
    print("Resetting database...")
    reset_database()
