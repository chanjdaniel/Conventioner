"""
Permission resolution and access control functions.
"""
from typing import Optional, List
from datatypes import Market, MarketRole, Organization
from db_config import get_database

db = get_database()
organizations_collection = db["organizations"]


def get_user_market_role(user_email: str, market: Market, organization: Optional[Organization] = None) -> Optional[MarketRole]:
    """
    Get user's effective role for a market.
    Returns None if user has no access.
    
    Resolution order:
    1. Check explicit market role (in market.roles dict)
    2. If no explicit role, check organization membership (returns VIEWER if user in org)
    3. Return None if no access
    """
    # 1. Check explicit market role
    if user_email in market.roles:
        return market.roles[user_email]
    
    # 2. Check organization-based access
    if market.organization:
        # If organization not provided, try to fetch it
        if organization is None:
            org_dict = organizations_collection.find_one({"name": market.organization})
            if org_dict:
                # Remove MongoDB _id before creating Organization object
                org_dict.pop('_id', None)
                try:
                    organization = Organization(**org_dict)
                except Exception:
                    organization = None
        
        if organization and organization.name == market.organization:
            # Check if user is in organization
            if (user_email == organization.owner or 
                user_email in organization.admins or 
                user_email in organization.members):
                return MarketRole.VIEWER  # Organization members get View permission
    
    return None  # No access


def user_has_permission(user_email: str, market: Market, required_role: MarketRole, organization: Optional[Organization] = None) -> bool:
    """
    Check if user has required permission level.
    
    Uses role hierarchy: Owner(4) > Admin(3) > Editor(2) > Viewer(1)
    Returns True if user_role >= required_role
    """
    user_role = get_user_market_role(user_email, market, organization)
    if user_role is None:
        return False
    
    # Permission hierarchy: Owner > Admin > Editor > Viewer
    role_hierarchy = {
        MarketRole.OWNER: 4,
        MarketRole.ADMIN: 3,
        MarketRole.EDITOR: 2,
        MarketRole.VIEWER: 1
    }
    
    return role_hierarchy[user_role] >= role_hierarchy[required_role]


def can_manage_roles(user_email: str, market: Market, target_role: MarketRole, organization: Optional[Organization] = None) -> bool:
    """
    Check if user can add/remove users with target_role.
    
    Rules:
    - Owner can manage all roles
    - Admin can manage Editor and Viewer only
    """
    user_role = get_user_market_role(user_email, market, organization)
    if user_role is None:
        return False
    
    # Owner can manage all roles
    if user_role == MarketRole.OWNER:
        return True
    
    # Admin can manage Editor and Viewer
    if user_role == MarketRole.ADMIN:
        return target_role in [MarketRole.EDITOR, MarketRole.VIEWER]
    
    return False


def get_user_organizations(user_email: str) -> List[Organization]:
    """
    Get all organizations where user is owner, admin, or member.
    """
    # Query organizations where user is in owner/admins/members
    org_dicts = organizations_collection.find({
        "$or": [
            {"owner": user_email},
            {"admins": user_email},
            {"members": user_email}
        ]
    })
    
    organizations = []
    for org_dict in org_dicts:
        # Remove MongoDB _id before creating Organization object
        org_dict.pop('_id', None)
        try:
            organizations.append(Organization(**org_dict))
        except Exception:
            # Skip invalid organizations
            continue
    
    return organizations
