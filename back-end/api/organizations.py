"""
Organization API functions for CRUD operations and role management.
"""
import uuid
from typing import Optional, Dict, Any, List
from pymongo.results import UpdateResult, DeleteResult
from bson import ObjectId
from datatypes import Organization
from db_config import get_database
import api.users as UsersApi

db = get_database()
organizations_collection = db["organizations"]
users_collection = db["users"]
markets_collection = db["markets"]


def create_organization(owner_email: str, name: str) -> str:
    """Create a new organization."""
    # Check if organization already exists
    existing_org = organizations_collection.find_one({"name": name})
    if existing_org:
        raise ValueError("Organization already exists")
    
    # Verify owner exists and get user id
    owner = UsersApi.get_user(owner_email)
    if not owner:
        raise ValueError("Owner user not found")
    owner_id = owner.id
    
    org_id = str(uuid.uuid4())
    org_dict = {
        "id": org_id,
        "name": name,
        "owner": owner_id,
        "admins": [],
        "members": [],
        "markets": [],
        "theme": None
    }
    
    organizations_collection.insert_one(org_dict)
    
    # Add organization id to user's organizations list
    users_collection.update_one(
        {"email": owner_email},
        {"$addToSet": {"organizations": org_id}}
    )
    
    return org_id


def get_organization(org_id: str) -> Optional[Dict[str, Any]]:
    """Get an organization by id."""
    org = organizations_collection.find_one({"id": org_id})
    if org:
        org['_id'] = str(org['_id'])
    return org


def get_organizations_for_user(user_email: str) -> List[Dict[str, Any]]:
    """Get all organizations where user is owner, admin, or member."""
    user = UsersApi.get_user(user_email)
    if not user:
        return []
    user_id = user.id
    orgs = organizations_collection.find({
        "$or": [
            {"owner": user_id},
            {"admins": user_id},
            {"members": user_id}
        ]
    })
    
    result = []
    for org in orgs:
        org['_id'] = str(org['_id'])
        # Resolve owner id to email for display (post-UUID migration)
        owner_id = org.get("owner")
        if owner_id:
            owner_user = UsersApi.get_user_by_id(owner_id)
            if owner_user:
                org["ownerEmail"] = owner_user.email
                org["owner_email"] = owner_user.email
        # Resolve admin and member ids to emails for display
        admin_emails = []
        for aid in org.get("admins", []):
            u = UsersApi.get_user_by_id(aid)
            if u:
                admin_emails.append(u.email)
        org["adminEmails"] = admin_emails
        org["admin_emails"] = admin_emails
        member_emails = []
        for mid in org.get("members", []):
            u = UsersApi.get_user_by_id(mid)
            if u:
                member_emails.append(u.email)
        org["memberEmails"] = member_emails
        org["member_emails"] = member_emails
        # Add user's role so frontend can show Manage button for owner/admin
        if org.get("owner") == user_id:
            org["userRole"] = "owner"
            org["user_role"] = "owner"
        elif user_id in org.get("admins", []):
            org["userRole"] = "admin"
            org["user_role"] = "admin"
        else:
            org["userRole"] = "member"
            org["user_role"] = "member"
        result.append(org)
    
    return result


def update_organization(org_id: str, requesting_user_email: str, updates: Dict[str, Any]) -> UpdateResult:
    """Update an organization. Only owner can update."""
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise ValueError("Organization not found")
    
    requesting_user = UsersApi.get_user(requesting_user_email)
    if not requesting_user:
        raise PermissionError("User not found")
    if org.get("owner") != requesting_user.id:
        raise PermissionError("Only organization owner can update organization")
    
    updates.pop("id", None)
    updates.pop("owner", None)
    updates.pop("_id", None)
    
    return organizations_collection.update_one(
        {"id": org_id},
        {"$set": updates}
    )


def delete_organization(org_id: str, requesting_user_email: str) -> DeleteResult:
    """Delete an organization. Only owner can delete."""
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise ValueError("Organization not found")
    
    requesting_user = UsersApi.get_user(requesting_user_email)
    if not requesting_user:
        raise PermissionError("User not found")
    if org.get("owner") != requesting_user.id:
        raise PermissionError("Only organization owner can delete organization")
    
    markets_collection.update_many(
        {"organization_id": org_id},
        {"$set": {"organization_id": None}}
    )
    
    users_collection.update_many(
        {},
        {"$pull": {"organizations": org_id}}
    )
    
    return organizations_collection.delete_one({"id": org_id})


def add_org_admin(org_id: str, user_email: str, requesting_user_email: str) -> bool:
    """Add a user as admin to organization. Only owner can add admins."""
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise ValueError("Organization not found")
    
    requesting_user = UsersApi.get_user(requesting_user_email)
    if not requesting_user:
        raise PermissionError("User not found")
    if org.get("owner") != requesting_user.id:
        raise PermissionError("Only organization owner can add admins")
    
    user = UsersApi.get_user(user_email)
    if not user:
        raise ValueError("User not found")
    
    if org.get("owner") == user.id:
        raise ValueError("Owner cannot be added as admin")
    
    result = organizations_collection.update_one(
        {"id": org_id},
        {"$addToSet": {"admins": user.id}}
    )
    
    users_collection.update_one(
        {"email": user_email},
        {"$addToSet": {"organizations": org_id}}
    )
    
    return result.modified_count > 0


def add_org_member(org_id: str, user_email: str, requesting_user_email: str) -> bool:
    """Add a user as member to organization. Owner or admin can add members."""
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise ValueError("Organization not found")
    
    requesting_user = UsersApi.get_user(requesting_user_email)
    if not requesting_user:
        raise PermissionError("User not found")
    if (org.get("owner") != requesting_user.id and
            requesting_user.id not in org.get("admins", [])):
        raise PermissionError("Only organization owner or admin can add members")
    
    user = UsersApi.get_user(user_email)
    if not user:
        raise ValueError("User not found")
    
    if org.get("owner") == user.id:
        raise ValueError("Owner cannot be added as member")
    if user.id in org.get("admins", []):
        raise ValueError("Admin cannot be added as member")
    
    result = organizations_collection.update_one(
        {"id": org_id},
        {"$addToSet": {"members": user.id}}
    )
    
    users_collection.update_one(
        {"email": user_email},
        {"$addToSet": {"organizations": org_id}}
    )
    
    return result.modified_count > 0


def remove_org_user(org_id: str, user_id: str, requesting_user_email: str) -> bool:
    """Remove a user from organization. Owner can remove anyone, admin can remove members."""
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise ValueError("Organization not found")
    
    requesting_user = UsersApi.get_user(requesting_user_email)
    if not requesting_user:
        raise PermissionError("User not found")
    is_owner = org.get("owner") == requesting_user.id
    is_admin = requesting_user.id in org.get("admins", [])
    
    if not is_owner and not is_admin:
        raise PermissionError("Only organization owner or admin can remove users")
    
    if org.get("owner") == user_id:
        raise ValueError("Cannot remove organization owner. Transfer ownership first.")
    
    removed = False
    if user_id in org.get("admins", []):
        if not is_owner:
            raise PermissionError("Only owner can remove admins")
        result = organizations_collection.update_one(
            {"id": org_id},
            {"$pull": {"admins": user_id}}
        )
        removed = result.modified_count > 0
    
    if user_id in org.get("members", []):
        result = organizations_collection.update_one(
            {"id": org_id},
            {"$pull": {"members": user_id}}
        )
        removed = removed or result.modified_count > 0
    
    users_collection.update_one(
        {"id": user_id},
        {"$pull": {"organizations": org_id}}
    )
    
    return removed


def transfer_org_ownership(org_id: str, current_owner_email: str, new_owner_email: str) -> bool:
    """Transfer organization ownership. Only current owner can transfer."""
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise ValueError("Organization not found")
    
    current_owner = UsersApi.get_user(current_owner_email)
    if not current_owner or org.get("owner") != current_owner.id:
        raise PermissionError("Only current owner can transfer ownership")
    
    new_owner = UsersApi.get_user(new_owner_email)
    if not new_owner:
        raise ValueError("New owner user not found")
    
    pull_updates = {}
    if new_owner.id in org.get("admins", []):
        pull_updates["admins"] = new_owner.id
    if new_owner.id in org.get("members", []):
        pull_updates["members"] = new_owner.id
    
    if pull_updates:
        organizations_collection.update_one(
            {"id": org_id},
            {"$pull": pull_updates}
        )
    
    if current_owner.id not in org.get("admins", []):
        organizations_collection.update_one(
            {"id": org_id},
            {"$addToSet": {"admins": current_owner.id}}
        )
    
    result = organizations_collection.update_one(
        {"id": org_id},
        {"$set": {"owner": new_owner.id}}
    )
    
    users_collection.update_one(
        {"email": new_owner_email},
        {"$addToSet": {"organizations": org_id}}
    )
    
    return result.modified_count > 0
