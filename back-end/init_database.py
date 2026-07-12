#!/usr/bin/env python3
"""
Script to initialize the conventioner database and create collections.
This ensures the database and collections exist even if mongo-init.js didn't run.

Usage:
    python init_database.py
"""

from db_config import get_database
from api.applications import APPLICATIONS_COLLECTION, MARKET_ID_FIELD

def init_database():
    """Initialize the database and create collections if they don't exist."""
    db = get_database('conventioner')

    collections_to_create = [
        'users', 'markets', 'source_data', 'organizations', 'attendance',
        APPLICATIONS_COLLECTION,
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

    # Verify collections exist
    existing_collections = db.list_collection_names()
    print(f"\n📊 Database 'conventioner' contains {len(existing_collections)} collection(s):")
    for coll in existing_collections:
        count = db[coll].count_documents({})
        print(f"   - {coll}: {count} document(s)")
    
    if created_collections:
        print(f"\n✅ Successfully initialized database with collections: {', '.join(created_collections)}")
    else:
        print("\n✅ Database already initialized")
    
    return True

if __name__ == "__main__":
    init_database()
