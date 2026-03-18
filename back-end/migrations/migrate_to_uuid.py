#!/usr/bin/env python3
"""
Migration script to add UUID primary keys to users, organizations, and markets.

This script:
1. Adds id (uuid4) to all users, organizations, markets that lack it
2. Creates unique index on id for each collection
3. Migrates references from names/emails to ids:
   - User.organizations: org name -> org id
   - Organization.owner/admins/members: email -> user id
   - Organization.markets: market name -> market id
   - Market.organization -> organization_id (org id)
   - Market.roles: email keys -> user id keys
   - source_data.market_name -> market_id

Usage:
    python migrations/migrate_to_uuid.py
"""

import sys
import os
import uuid

# Add parent directory to path to import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db_config import get_database


def migrate_to_uuid():
    """Run the UUID migration."""
    db = get_database()
    users_collection = db["users"]
    organizations_collection = db["organizations"]
    markets_collection = db["markets"]
    source_data_collection = db["source_data"]

    # Phase 1: Add ids to all entities
    print("Phase 1: Adding ids to entities...")

    email_to_user_id = {}
    for user in users_collection.find({}):
        email = user.get("email")
        if not email:
            print(f"  ⚠ Skipping user with no email: {user.get('_id')}")
            continue
        if "id" not in user:
            user_id = str(uuid.uuid4())
            users_collection.update_one(
                {"_id": user["_id"]},
                {"$set": {"id": user_id}}
            )
            email_to_user_id[email] = user_id
            print(f"  ✓ User {email} -> id {user_id[:8]}...")
        else:
            email_to_user_id[email] = user["id"]

    name_to_org_id = {}
    for org in organizations_collection.find({}):
        name = org.get("name")
        if not name:
            print(f"  ⚠ Skipping org with no name: {org.get('_id')}")
            continue
        if "id" not in org:
            org_id = str(uuid.uuid4())
            organizations_collection.update_one(
                {"_id": org["_id"]},
                {"$set": {"id": org_id}}
            )
            name_to_org_id[name] = org_id
            print(f"  ✓ Organization {name} -> id {org_id[:8]}...")
        else:
            name_to_org_id[name] = org["id"]

    name_to_market_id = {}
    for market in markets_collection.find({}):
        name = market.get("name")
        if not name:
            print(f"  ⚠ Skipping market with no name: {market.get('_id')}")
            continue
        if "id" not in market:
            market_id = str(uuid.uuid4())
            markets_collection.update_one(
                {"_id": market["_id"]},
                {"$set": {"id": market_id}}
            )
            name_to_market_id[name] = market_id
            print(f"  ✓ Market {name} -> id {market_id[:8]}...")
        else:
            name_to_market_id[name] = market["id"]

    # Phase 2: Migrate references
    print("\nPhase 2: Migrating references...")

    # Users: organizations (names -> ids)
    for user in users_collection.find({}):
        org_names = user.get("organizations", [])
        if not org_names:
            continue
        org_ids = []
        for name in org_names:
            if name in name_to_org_id:
                org_ids.append(name_to_org_id[name])
            else:
                print(f"  ⚠ User {user.get('email')}: org '{name}' not found, skipping")
        if org_ids:
            users_collection.update_one(
                {"_id": user["_id"]},
                {"$set": {"organizations": org_ids}}
            )
            print(f"  ✓ User {user.get('email')}: organizations updated")

    # Organizations: owner, admins, members (emails -> user ids); markets (names -> ids)
    for org in organizations_collection.find({}):
        updates = {}
        owner_email = org.get("owner")
        if owner_email and owner_email in email_to_user_id:
            updates["owner"] = email_to_user_id[owner_email]
        admins = org.get("admins", [])
        admin_ids = [email_to_user_id[e] for e in admins if e in email_to_user_id]
        if admin_ids:
            updates["admins"] = admin_ids
        members = org.get("members", [])
        member_ids = [email_to_user_id[e] for e in members if e in email_to_user_id]
        if member_ids:
            updates["members"] = member_ids
        market_names = org.get("markets", [])
        market_ids = [name_to_market_id[n] for n in market_names if n in name_to_market_id]
        if market_ids:
            updates["markets"] = market_ids
        if updates:
            organizations_collection.update_one(
                {"_id": org["_id"]},
                {"$set": updates}
            )
            print(f"  ✓ Organization {org.get('name')}: references updated")

    # Markets: organization -> organization_id; roles keys (emails -> user ids)
    for market in markets_collection.find({}):
        set_updates = {}
        unset_updates = {}
        org_name = market.get("organization")
        if org_name and org_name in name_to_org_id:
            set_updates["organization_id"] = name_to_org_id[org_name]
        if "organization" in market:
            unset_updates["organization"] = ""
        roles = market.get("roles", {})
        if roles:
            new_roles = {}
            for email_or_id, role in roles.items():
                if email_or_id in email_to_user_id:
                    new_roles[email_to_user_id[email_or_id]] = role
                else:
                    new_roles[email_or_id] = role  # Already an id
            set_updates["roles"] = new_roles
        if set_updates:
            markets_collection.update_one(
                {"_id": market["_id"]},
                {"$set": set_updates}
            )
        if unset_updates:
            markets_collection.update_one(
                {"_id": market["_id"]},
                {"$unset": unset_updates}
            )
        if set_updates or unset_updates:
            print(f"  ✓ Market {market.get('name')}: references updated")

    # Source data: market_name -> market_id
    for doc in source_data_collection.find({}):
        market_name = doc.get("market_name")
        if market_name and market_name in name_to_market_id:
            source_data_collection.update_one(
                {"_id": doc["_id"]},
                {"$set": {"market_id": name_to_market_id[market_name]}, "$unset": {"market_name": ""}}
            )
            print(f"  ✓ Source data for market '{market_name}' -> market_id")

    # Phase 3: Create indexes
    print("\nPhase 3: Creating indexes...")
    try:
        users_collection.create_index("id", unique=True)
        organizations_collection.create_index("id", unique=True)
        markets_collection.create_index("id", unique=True)
        print("  ✓ Unique indexes on id created")
    except Exception as e:
        print(f"  ⚠ Index creation: {e}")

    print("\n✅ UUID migration complete")
    return True


def main():
    print("=" * 60)
    print("Starting UUID migration...")
    print("=" * 60)
    try:
        migrate_to_uuid()
    except Exception as e:
        print(f"\n❌ Migration failed: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
