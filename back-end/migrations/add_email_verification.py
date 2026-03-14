#!/usr/bin/env python3
"""
Migration script to add email verification, password reset, and OTP fields to existing users.

This script:
1. Adds email_verified field (default: False)
2. Adds verification_token, verification_token_expires fields (default: None)
3. Adds password_reset_token, password_reset_token_expires fields (default: None)
4. Adds otp, otp_expires, otp_attempts fields (default: None, None, 0)

Usage:
    python migrations/add_email_verification.py
"""

import sys
import os

# Add parent directory to path to import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db_config import get_database

def migrate_user_fields():
    """Add email verification fields to existing users."""
    db = get_database()
    users_collection = db["users"]
    
    users = list(users_collection.find({}))
    migrated_count = 0
    
    print(f"Found {len(users)} users to migrate...")
    
    for user in users:
        user_id = user.get("_id")
        update_data = {"$set": {}}
        
        # Add fields if they don't exist
        if 'email_verified' not in user:
            update_data["$set"]["email_verified"] = False
        
        if 'verification_token' not in user:
            update_data["$set"]["verification_token"] = None
        
        if 'verification_token_expires' not in user:
            update_data["$set"]["verification_token_expires"] = None
        
        if 'password_reset_token' not in user:
            update_data["$set"]["password_reset_token"] = None
        
        if 'password_reset_token_expires' not in user:
            update_data["$set"]["password_reset_token_expires"] = None
        
        if 'otp' not in user:
            update_data["$set"]["otp"] = None
        
        if 'otp_expires' not in user:
            update_data["$set"]["otp_expires"] = None
        
        if 'otp_attempts' not in user:
            update_data["$set"]["otp_attempts"] = 0
        
        if update_data["$set"]:
            users_collection.update_one(
                {"_id": user_id},
                update_data
            )
            migrated_count += 1
            print(f"  ✓ Migrated user: {user.get('email', 'unknown')}")
    
    print(f"\n✅ Migrated {migrated_count} users")
    return migrated_count


def main():
    """Run the migration."""
    print("=" * 60)
    print("Starting email verification fields migration...")
    print("=" * 60)
    
    try:
        migrated_count = migrate_user_fields()
        
        print("\n" + "=" * 60)
        print(f"Migration complete!")
        print(f"  - Users migrated: {migrated_count}")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ Migration failed: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
