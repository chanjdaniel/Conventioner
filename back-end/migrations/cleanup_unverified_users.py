#!/usr/bin/env python3
"""
Cleanup script to delete unverified user accounts.

This script:
1. Finds all users with email_verified=False
2. Optionally filters by email address
3. Deletes the unverified users

Usage:
    # Delete all unverified users
    python migrations/cleanup_unverified_users.py
    
    # Delete a specific unverified user by email
    python migrations/cleanup_unverified_users.py --email user@example.com
    
    # Dry run (show what would be deleted without actually deleting)
    python migrations/cleanup_unverified_users.py --dry-run
"""

import sys
import os
import argparse
from datetime import datetime

# Add parent directory to path to import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db_config import get_database

def cleanup_unverified_users(email=None, dry_run=False):
    """Delete unverified user accounts.
    
    Args:
        email: Optional email address to delete specific user
        dry_run: If True, only show what would be deleted without actually deleting
    
    Returns:
        Number of users deleted
    """
    db = get_database()
    users_collection = db["users"]
    
    # Build query
    query = {"email_verified": False}
    if email:
        query["email"] = email
    
    # Find unverified users
    unverified_users = list(users_collection.find(query))
    
    if not unverified_users:
        print(f"No unverified users found{' matching email ' + email if email else ''}")
        return 0
    
    print(f"\nFound {len(unverified_users)} unverified user(s):")
    print("-" * 60)
    for user in unverified_users:
        user_email = user.get("email", "unknown")
        created_info = ""
        if "_id" in user:
            # MongoDB ObjectId contains timestamp
            from bson import ObjectId
            try:
                created_time = user["_id"].generation_time
                created_info = f" (created: {created_time.strftime('%Y-%m-%d %H:%M:%S')})"
            except:
                pass
        print(f"  - {user_email}{created_info}")
    print("-" * 60)
    
    if dry_run:
        print(f"\n[DRY RUN] Would delete {len(unverified_users)} user(s)")
        print("Run without --dry-run to actually delete these users.")
        return 0
    
    # Confirm deletion
    if not email:
        response = input(f"\nDelete {len(unverified_users)} unverified user(s)? (yes/no): ")
        if response.lower() not in ['yes', 'y']:
            print("Cancelled.")
            return 0
    
    # Delete users
    deleted_count = 0
    for user in unverified_users:
        user_email = user.get("email", "unknown")
        result = users_collection.delete_one({"_id": user["_id"]})
        if result.deleted_count > 0:
            deleted_count += 1
            print(f"  ✓ Deleted: {user_email}")
        else:
            print(f"  ✗ Failed to delete: {user_email}")
    
    print(f"\n✅ Deleted {deleted_count} unverified user(s)")
    return deleted_count


def main():
    """Run the cleanup."""
    parser = argparse.ArgumentParser(
        description="Cleanup unverified user accounts",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Delete all unverified users
  python migrations/cleanup_unverified_users.py
  
  # Delete specific user
  python migrations/cleanup_unverified_users.py --email user@example.com
  
  # Dry run (see what would be deleted)
  python migrations/cleanup_unverified_users.py --dry-run
        """
    )
    parser.add_argument(
        "--email",
        type=str,
        help="Email address of specific user to delete"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be deleted without actually deleting"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("Unverified Users Cleanup")
    print("=" * 60)
    
    if args.dry_run:
        print("[DRY RUN MODE - No users will be deleted]")
    
    try:
        deleted_count = cleanup_unverified_users(
            email=args.email,
            dry_run=args.dry_run
        )
        
        print("\n" + "=" * 60)
        if args.dry_run:
            print("Dry run complete!")
        else:
            print(f"Cleanup complete! Deleted {deleted_count} user(s)")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ Cleanup failed: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
