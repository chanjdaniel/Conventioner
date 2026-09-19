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
)

# GridFS buckets, which are a pair of collections each and are not listed above.
GRIDFS_BUCKETS = ('floorplan_images',)

PRESERVED = ('schema_migrations',)


def reset_database():
    """Delete all documents from every application collection."""
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
