"""
Organization API functions for CRUD operations and role management.
"""
from typing import Optional, Dict, Any, List
from pymongo.results import InsertOneResult, UpdateResult, DeleteResult
from bson import ObjectId
from datatypes import Organization
from db_config import get_database
import api.users as UsersApi

db = get_database()
organizations_collection = db["organizations"]
users_collection = db["users"]
markets_collection = db["markets"]


def create_organization(owner_email: str, name: str) -> InsertOneResult:
    """Create a new organization."""
    # Check if organization already exists
    existing_org = organizations_collection.find_one({"name": name})
    if existing_org:
        raise ValueError("Organization already exists")
    
    # Verify owner exists
    owner = UsersApi.get_user(owner_email)
    if not owner:
        raise ValueError("Owner user not found")
    
    # Create organization
    org_dict = {
        "name": name,
        "owner": owner_email,
        "admins": [],
        "members": [],
        "markets": [],
        "theme": None
    }
    
    result = organizations_collection.insert_one(org_dict)
    
    # Add organization to user's organizations list
    users_collection.update_one(
        {"email": owner_email},
        {"$addToSet": {"organizations": name}}
    )
    
    return result


def get_organization(name: str) -> Optional[Dict[str, Any]]:
    """Get an organization by name."""
    org = organizations_collection.find_one({"name": name})
    if org:
        org['_id'] = str(org['_id'])
    return org


def get_organizations_for_user(user_email: str) -> List[Dict[str, Any]]:
    """Get all organizations where user is owner, admin, or member."""
    orgs = organizations_collection.find({
        "$or": [
            {"owner": user_email},
            {"admins": user_email},
            {"members": user_email}
        ]
    })
    
    result = []
    for org in orgs:
        org['_id'] = str(org['_id'])
        result.append(org)
    
    return result


def update_organization(name: str, requesting_user: str, updates: Dict[str, Any]) -> UpdateResult:
    """Update an organization. Only owner can update."""
    org = organizations_collection.find_one({"name": name})
    if not org:
        raise ValueError("Organization not found")
    
    # Verify requesting user is owner
    if org.get("owner") != requesting_user:
        raise PermissionError("Only organization owner can update organization")
    
    # Remove fields that shouldn't be updated directly
    updates.pop("name", None)  # Name cannot be changed
    updates.pop("owner", None)  # Use transfer_ownership instead
    updates.pop("_id", None)
    
    return organizations_collection.update_one(
        {"name": name},
        {"$set": updates}
    )


def delete_organization(name: str, requesting_user: str) -> DeleteResult:
    """Delete an organization. Only owner can delete."""
    org = organizations_collection.find_one({"name": name})
    if not org:
        raise ValueError("Organization not found")
    
    # Verify requesting user is owner
    if org.get("owner") != requesting_user:
        raise PermissionError("Only organization owner can delete organization")
    
    # Orphan markets (set organization to None)
    markets_collection.update_many(
        {"organization": name},
        {"$set": {"organization": None}}
    )
    
    # Remove organization from all users' organizations lists
    users_collection.update_many(
        {},
        {"$pull": {"organizations": name}}
    )
    
    # Delete organization
    return organizations_collection.delete_one({"name": name})


def add_org_admin(org_name: str, user_email: str, requesting_user: str) -> bool:
    """Add a user as admin to organization. Only owner can add admins."""
    org = organizations_collection.find_one({"name": org_name})
    if not org:
        raise ValueError("Organization not found")
    
    # Verify requesting user is owner
    if org.get("owner") != requesting_user:
        raise PermissionError("Only organization owner can add admins")
    
    # Verify user exists
    user = UsersApi.get_user(user_email)
    if not user:
        raise ValueError("User not found")
    
    # Prevent adding owner as admin
    if org.get("owner") == user_email:
        raise ValueError("Owner cannot be added as admin")
    
    # Add to admins if not already there
    result = organizations_collection.update_one(
        {"name": org_name},
        {"$addToSet": {"admins": user_email}}
    )
    
    # Add organization to user's organizations list if not already there
    users_collection.update_one(
        {"email": user_email},
        {"$addToSet": {"organizations": org_name}}
    )
    
    return result.modified_count > 0


def add_org_member(org_name: str, user_email: str, requesting_user: str) -> bool:
    """Add a user as member to organization. Owner or admin can add members."""
    org = organizations_collection.find_one({"name": org_name})
    if not org:
        raise ValueError("Organization not found")
    
    # Verify requesting user is owner or admin
    if (org.get("owner") != requesting_user and 
        requesting_user not in org.get("admins", [])):
        raise PermissionError("Only organization owner or admin can add members")
    
    # Verify user exists
    user = UsersApi.get_user(user_email)
    if not user:
        raise ValueError("User not found")
    
    # Prevent adding owner or admin as member
    if org.get("owner") == user_email:
        raise ValueError("Owner cannot be added as member")
    if user_email in org.get("admins", []):
        raise ValueError("Admin cannot be added as member")
    
    # Add to members if not already there
    result = organizations_collection.update_one(
        {"name": org_name},
        {"$addToSet": {"members": user_email}}
    )
    
    # Add organization to user's organizations list if not already there
    users_collection.update_one(
        {"email": user_email},
        {"$addToSet": {"organizations": org_name}}
    )
    
    return result.modified_count > 0


def remove_org_user(org_name: str, user_email: str, requesting_user: str) -> bool:
    """Remove a user from organization. Owner can remove anyone, admin can remove members."""
    org = organizations_collection.find_one({"name": org_name})
    if not org:
        raise ValueError("Organization not found")
    
    # Verify requesting user has permission
    is_owner = org.get("owner") == requesting_user
    is_admin = requesting_user in org.get("admins", [])
    
    if not is_owner and not is_admin:
        raise PermissionError("Only organization owner or admin can remove users")
    
    # Prevent removing owner
    if org.get("owner") == user_email:
        raise ValueError("Cannot remove organization owner. Transfer ownership first.")
    
    # Determine which list to remove from
    removed = False
    
    # Remove from admins if present
    if user_email in org.get("admins", []):
        if not is_owner:
            raise PermissionError("Only owner can remove admins")
        result = organizations_collection.update_one(
            {"name": org_name},
            {"$pull": {"admins": user_email}}
        )
        removed = result.modified_count > 0
    
    # Remove from members if present
    if user_email in org.get("members", []):
        result = organizations_collection.update_one(
            {"name": org_name},
            {"$pull": {"members": user_email}}
        )
        removed = removed or result.modified_count > 0
    
    # Remove organization from user's organizations list
    users_collection.update_one(
        {"email": user_email},
        {"$pull": {"organizations": org_name}}
    )
    
    return removed


def transfer_org_ownership(org_name: str, current_owner: str, new_owner_email: str) -> bool:
    """Transfer organization ownership. Only current owner can transfer."""
    org = organizations_collection.find_one({"name": org_name})
    if not org:
        raise ValueError("Organization not found")
    
    # Verify current_owner is actual owner
    if org.get("owner") != current_owner:
        raise PermissionError("Only current owner can transfer ownership")
    
    # Verify new owner exists
    new_owner = UsersApi.get_user(new_owner_email)
    if not new_owner:
        raise ValueError("New owner user not found")
    
    # Move current owner to admins (or keep as admin if already admin)
    updates = {
        "$set": {"owner": new_owner_email}
    }
    
    # Remove new owner from admins/members if present
    pull_updates = {}
    if new_owner_email in org.get("admins", []):
        pull_updates["admins"] = new_owner_email
    if new_owner_email in org.get("members", []):
        pull_updates["members"] = new_owner_email
    
    if pull_updates:
        organizations_collection.update_one(
            {"name": org_name},
            {"$pull": pull_updates}
        )
    
    # Add current owner to admins if not already there
    if current_owner not in org.get("admins", []):
        organizations_collection.update_one(
            {"name": org_name},
            {"$addToSet": {"admins": current_owner}}
        )
    
    # Update owner
    result = organizations_collection.update_one(
        {"name": org_name},
        updates
    )
    
    # Ensure new owner has organization in their list
    users_collection.update_one(
        {"email": new_owner_email},
        {"$addToSet": {"organizations": org_name}}
    )
    
    return result.modified_count > 0
