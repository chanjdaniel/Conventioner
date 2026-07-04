#!/usr/bin/env python3
"""
Script to create a test user directly in MongoDB.
This bypasses the API and creates a user with a properly hashed password.

Usage:
    python create_test_user.py <email> <password>
    
Example:
    python create_test_user.py test@example.com testpassword
"""

import sys
from datetime import datetime, timezone
from flask_bcrypt import Bcrypt
from db_config import get_database

def create_test_user(email: str, password: str, organizations=None, markets=None):
    """Create a test user in the database ready for immediate login."""
    if organizations is None:
        organizations = []
    if markets is None:
        markets = []
    
    db = get_database()
    users_collection = db["users"]
    
    # Check if user already exists
    existing_user = users_collection.find_one({"email": email})
    if existing_user:
        print(f"❌ User with email '{email}' already exists!")
        return False
    
    # Hash the password
    bcrypt = Bcrypt()
    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
    
    # Create user document with all required fields for the Pydantic User model
    # and email_verified=True so the user can log in immediately without
    # going through the email verification flow.
    user_doc = {
        "email": email,
        "password": hashed_password,
        "organizations": organizations,
        "markets": markets,
        "email_verified": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    
    # Insert into database
    result = users_collection.insert_one(user_doc)
    
    if result.inserted_id:
        # Set the 'id' field to match the MongoDB _id (required by Pydantic User model)
        user_id = str(result.inserted_id)
        users_collection.update_one(
            {"_id": result.inserted_id},
            {"$set": {"id": user_id}},
        )
        print(f"✅ Successfully created test user:")
        print(f"   Email: {email}")
        print(f"   Password: {password}")
        print(f"   User ID: {user_id}")
        return True
    else:
        print("❌ Failed to create user")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python create_test_user.py <email> <password>")
        print("Example: python create_test_user.py test@example.com testpassword")
        sys.exit(1)
    
    email = sys.argv[1]
    password = sys.argv[2]
    
    create_test_user(email, password)
