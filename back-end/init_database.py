#!/usr/bin/env python3
"""
Script to initialize the conventioner database and create collections.
This ensures the database and collections exist even if mongo-init.js didn't run.

Usage:
    python init_database.py
"""

from db_config import get_database
from api.applications import (
    APPLICANT_EMAIL_FIELD,
    APPLICANT_IDENTITY_INDEX,
    APPLICATION_TYPE_FIELD,
    APPLICATIONS_COLLECTION,
    MARKET_ID_FIELD,
)
from market_documents import (
    MARKET_KEY_MIGRATION,
    MARKET_SLUG_INDEX,
    MARKETS_COLLECTION,
    SCHEMA_COLLECTION,
    ensure_market_slug_index,
    pending_market_key_rewrites,
    record_market_key_migration,
)

def init_database():
    """Initialize the database and create collections if they don't exist."""
    db = get_database('conventioner')

    collections_to_create = [
        'users', 'markets', 'source_data', 'organizations', 'attendance',
        APPLICATIONS_COLLECTION, SCHEMA_COLLECTION,
    ]
    created_collections = []

    for collection_name in collections_to_create:
        # Check if collection exists
        if collection_name not in db.list_collection_names():
            # Create collection
            db.create_collection(collection_name)
            print(f"✅ Created collection: {collection_name}")
            created_collections.append(collection_name)
        else:
            print(f"ℹ️  Collection already exists: {collection_name}")

    # The D9 application-form lock counts applications by market, so that lookup is indexed.
    db[APPLICATIONS_COLLECTION].create_index([(MARKET_ID_FIELD, 1)])
    print(f"✅ Ensured index on {APPLICATIONS_COLLECTION}.{MARKET_ID_FIELD}")

    # An applicant is one applicant: the public request-key endpoint reads before it inserts, so
    # only the database can stop two concurrent requests for one address from leaving two
    # applications behind. See ``api.applications.ensure_application_indexes``.
    db[APPLICATIONS_COLLECTION].create_index(
        [(MARKET_ID_FIELD, 1), (APPLICANT_EMAIL_FIELD, 1), (APPLICATION_TYPE_FIELD, 1)],
        unique=True,
        name=APPLICANT_IDENTITY_INDEX,
    )
    print(f"✅ Ensured unique index {APPLICANT_IDENTITY_INDEX} on {APPLICATIONS_COLLECTION}")

    # Every public URL a market appears on resolves it by the slug of its name, on an
    # unauthenticated endpoint. See ``market_documents.ensure_market_slug_index``.
    ensure_market_slug_index(db)
    print(f"✅ Ensured index {MARKET_SLUG_INDEX} on {MARKETS_COLLECTION}")

    # Verify collections exist
    existing_collections = db.list_collection_names()
    print(f"\n📊 Database 'conventioner' contains {len(existing_collections)} collection(s):")
    for coll in existing_collections:
        count = db[coll].count_documents({})
        print(f"   - {coll}: {count} document(s)")
    
    # The app refuses to boot unless the market-document migration is recorded as applied. A
    # database whose markets are all in canonical form -- camelCase keys, and a stored slug --
    # already satisfies it, an empty one trivially so, and recording that here is what lets a
    # fresh install boot. Documents that do need rewriting are not touched: that is the
    # migration's job, and the operator's call.
    pending = pending_market_key_rewrites(db)
    if pending:
        print(f"\n⚠️  {len(pending)} market(s) are not in canonical form (legacy keys, or no slug).")
        print(f"   The app will refuse to boot. Run: python {MARKET_KEY_MIGRATION}")
    else:
        record_market_key_migration(db)
        print("\n✅ Market documents are in canonical form")

    if created_collections:
        print(f"\n✅ Successfully initialized database with collections: {', '.join(created_collections)}")
    else:
        print("\n✅ Database already initialized")

    return True

if __name__ == "__main__":
    init_database()
