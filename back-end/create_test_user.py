#!/usr/bin/env python3
"""
Script to create a test user directly in MongoDB.
This bypasses the API and creates a user with a properly hashed password.

Usage, in the back-end container of the stack to seed, which sets MONGODB_HOST:
    python create_test_user.py <email> <password>
    python create_test_user.py --bulk <password> <email>...

Example:
    python create_test_user.py test@example.com testpassword

The bulk form makes each address as the one-address form does, in one process with the password
hashed once, for a seed of many people (T204); an address already made is left as it is. It prints
one line per address, "created <email> <id>" or "exists <email> <id>", and never the password.
"""

import sys
from datetime import datetime, timezone
from flask_bcrypt import Bcrypt
from db_config import get_database, require_named_database
from utils.email_address import normalized_email

def _users():
    """The users collection of the database the environment names, refusing any other."""
    require_named_database()
    return get_database()["users"]


def _hashed(password: str) -> str:
    return Bcrypt().generate_password_hash(password).decode('utf-8')


def _insert_verified(users_collection, email: str, hashed_password: str, organizations=None,
                     markets=None):
    """Insert a verified account for an address already normalized; answers its id, or None."""
    # Create user document with all required fields for the Pydantic User model
    # and email_verified=True so the user can log in immediately without
    # going through the email verification flow.
    user_doc = {
        "email": email,
        "password": hashed_password,
        "organizations": organizations or [],
        "markets": markets or [],
        "email_verified": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    result = users_collection.insert_one(user_doc)
    if not result.inserted_id:
        return None
    # Set the 'id' field to match the MongoDB _id (required by Pydantic User model)
    user_id = str(result.inserted_id)
    users_collection.update_one({"_id": result.inserted_id}, {"$set": {"id": user_id}})
    return user_id


def create_test_user(email: str, password: str, organizations=None, markets=None):
    """Create a test user in the database ready for immediate login."""
    users_collection = _users()
    # Stored as every writer stores it (E32/F03/S04): the unique index is over this form.
    email = normalized_email(email)

    # Check if user already exists
    existing_user = users_collection.find_one({"email": email})
    if existing_user:
        print(f"❌ User with email '{email}' already exists!")
        return False

    user_id = _insert_verified(
        users_collection, email, _hashed(password), organizations, markets)
    if user_id:
        print(f"✅ Successfully created test user:")
        print(f"   Email: {email}")
        print(f"   Password: {password}")
        print(f"   User ID: {user_id}")
        return True
    else:
        print("❌ Failed to create user")
        return False


def create_test_users(emails, password: str) -> dict:
    """Create a verified account for each address not already one, with one password hashed once,
    printing a line for each; answers every address's account id, made or found."""
    users_collection = _users()
    hashed_password = None
    ids = {}
    for email in dict.fromkeys(normalized_email(email) for email in emails):
        existing_user = users_collection.find_one({"email": email})
        if existing_user:
            ids[email] = existing_user["id"]
            print(f"exists {email} {ids[email]}")
            continue
        if hashed_password is None:
            hashed_password = _hashed(password)
        user_id = _insert_verified(users_collection, email, hashed_password)
        if not user_id:
            sys.exit(f"Failed to create {email}")
        ids[email] = user_id
        print(f"created {email} {user_id}")
    return ids


USAGE = """Usage: python create_test_user.py <email> <password>
       python create_test_user.py --bulk <password> <email>...
Example: python create_test_user.py test@example.com testpassword"""


def main(argv):
    if argv[:1] == ["--bulk"] and len(argv) >= 3:
        create_test_users(argv[2:], argv[1])
    elif argv[:1] != ["--bulk"] and len(argv) >= 2:
        create_test_user(argv[0], argv[1])
    else:
        print(USAGE)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
