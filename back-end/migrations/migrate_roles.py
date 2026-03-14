#!/usr/bin/env python3
"""
Migration script to convert old role lists to new roles dictionary structure.

This script:
1. Migrates Market roles from separate lists (owner, editors, viewers) to roles dict
2. Migrates Organization structure from users list to owner/admins/members structure

Usage:
    python migrations/migrate_roles.py
"""

import sys
import os

# Add parent directory to path to import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db_config import get_database
from datatypes import MarketRole

def migrate_market_roles():
    """Ensure markets have roles dict and remove old fields."""
    db = get_database()
    markets_collection = db["markets"]
    
    markets = list(markets_collection.find({}))
    migrated_count = 0
    
    print(f"Found {len(markets)} markets to clean up...")
    
    for market in markets:
        market_id = market.get("_id")
        update_data = {"$unset": {}}
        
        # Remove old fields if they exist
        if 'owner' in market:
            update_data["$unset"]["owner"] = ""
        if 'editors' in market:
            update_data["$unset"]["editors"] = ""
        if 'viewers' in market:
            update_data["$unset"]["viewers"] = ""
        
        # Ensure required fields exist
        set_data = {}
        if 'roles' not in market or not market.get('roles'):
            # Market must have roles - this is an error state
            print(f"  ⚠ Warning: Market {market.get('name', 'unknown')} has no roles dict!")
            continue
        
        if 'organization' not in market:
            set_data["organization"] = None
        if 'theme' not in market:
            set_data["theme"] = None
        
        if update_data["$unset"] or set_data:
            if set_data:
                update_data["$set"] = set_data
            markets_collection.update_one(
                {"_id": market_id},
                update_data
            )
            migrated_count += 1
            print(f"  ✓ Cleaned up market: {market.get('name', 'unknown')}")
    
    print(f"\n✅ Cleaned up {migrated_count} markets")
    return migrated_count


def migrate_organization_structure():
    """Remove old users field from organizations."""
    db = get_database()
    organizations_collection = db["organizations"]
    
    organizations = list(organizations_collection.find({}))
    migrated_count = 0
    
    if not organizations:
        print("No organizations found.")
        return 0
    
    print(f"\nFound {len(organizations)} organizations to clean up...")
    
    for org in organizations:
        org_id = org.get("_id")
        update_data = {"$unset": {}}
        
        # Remove old users field if it exists
        if 'users' in org:
            update_data["$unset"]["users"] = ""
        
        # Ensure theme field exists
        set_data = {}
        if 'theme' not in org:
            set_data["theme"] = None
        
        if update_data["$unset"] or set_data:
            if set_data:
                update_data["$set"] = set_data
            organizations_collection.update_one(
                {"_id": org_id},
                update_data
            )
            migrated_count += 1
            print(f"  ✓ Cleaned up organization: {org.get('name', 'unknown')}")
    
    print(f"\n✅ Cleaned up {migrated_count} organizations")
    return migrated_count


def main():
    """Run all migrations."""
    print("=" * 60)
    print("Starting role migration...")
    print("=" * 60)
    
    try:
        # Migrate markets
        market_count = migrate_market_roles()
        
        # Migrate organizations
        org_count = migrate_organization_structure()
        
        print("\n" + "=" * 60)
        print(f"Migration complete!")
        print(f"  - Markets migrated: {market_count}")
        print(f"  - Organizations migrated: {org_count}")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ Migration failed: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
