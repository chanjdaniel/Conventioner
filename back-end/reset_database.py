#!/usr/bin/env python3
"""
Script to reset the database by deleting all test data.
Wipes organizations, markets, source_data, and users.

Usage:
    python reset_database.py
"""

from db_config import get_database


def reset_database():
    """Delete all documents from app collections."""
    db = get_database()
    
    collections = ['organizations', 'markets', 'source_data', 'users']
    
    for name in collections:
        coll = db[name]
        result = coll.delete_many({})
        print(f"  {name}: deleted {result.deleted_count} document(s)")
    
    print("\n✅ Database reset complete")


if __name__ == "__main__":
    print("Resetting database...")
    reset_database()
