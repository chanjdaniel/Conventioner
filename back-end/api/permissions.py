"""
Permission resolution and access control functions.
"""
from typing import Iterable, List, Optional
from datatypes import Market, MarketRole, Organization
from db_config import get_database
import api.users as UsersApi

db = get_database()
organizations_collection = db["organizations"]


ROLE_RANK = {
    MarketRole.OWNER: 4,
    MarketRole.ADMIN: 3,
    MarketRole.EDITOR: 2,
    MarketRole.VIEWER: 1,
}


def organization_market_role(
    user_id: str, owner: Optional[str], admins: Iterable[str], members: Iterable[str],
) -> Optional[MarketRole]:
    """What a person's place in an organization gives them on every market it holds.

    An organization's admins run its markets: its owner and admins hold Admin, as a market's Admin
    does, and a member reads them. Never Owner: a market has exactly one, the person named on it,
    who alone deletes it and manages its admins.
    """
    if user_id == owner or user_id in admins:
        return MarketRole.ADMIN
    if user_id in members:
        return MarketRole.VIEWER
    return None


def higher_role(*roles: Optional[MarketRole]) -> Optional[MarketRole]:
    """The highest of the roles a person holds, or None when they hold none.

    A role on the market and a role through its organization are both held, and the higher one
    counts: an organization admin once given Viewer on one market is not held to it.
    """
    held = [role for role in roles if role is not None]
    return max(held, key=ROLE_RANK.__getitem__) if held else None


def get_user_market_role(user_email: str, market: Market, organization: Optional[Organization] = None) -> Optional[MarketRole]:
    """
    Get user's effective role for a market: the higher of their role on the market itself
    (``market.roles``, keyed by user id) and what their place in its organization gives
    (``organization_market_role``). Returns None if user has no access.
    """
    user = UsersApi.get_user(user_email)
    if not user:
        return None
    user_id = user.id

    through_organization = None
    if market.organization_id:
        if organization is None:
            org_dict = organizations_collection.find_one({"id": market.organization_id})
            if org_dict:
                org_dict.pop('_id', None)
                try:
                    organization = Organization(**org_dict)
                except Exception:
                    organization = None

        if organization and organization.id == market.organization_id:
            through_organization = organization_market_role(
                user_id, organization.owner, organization.admins, organization.members
            )

    return higher_role(market.roles.get(user_id), through_organization)


def people_with_market_role(market: Market, organization: Optional[Organization]) -> List[str]:
    """The user ids of everyone who holds any role on the market, by ``get_user_market_role``'s rule.

    The people named in its roles, then its organization's owner, admins and members, each once
    and each kept only if the rule gives them a role: everyone who can see the market, and so may
    own a follow-up on it.
    """
    roles = market.roles or {}
    if organization is None or organization.id != market.organization_id:
        return list(roles)
    candidates = [*roles, organization.owner, *organization.admins, *organization.members]
    return [
        user_id for user_id in dict.fromkeys(candidates)
        if user_id and higher_role(roles.get(user_id), organization_market_role(
            user_id, organization.owner, organization.admins, organization.members))
    ]


def user_has_permission(user_email: str, market: Market, required_role: MarketRole, organization: Optional[Organization] = None) -> bool:
    """
    Check if user has required permission level.
    
    Uses role hierarchy: Owner(4) > Admin(3) > Editor(2) > Viewer(1)
    Returns True if user_role >= required_role
    """
    user_role = get_user_market_role(user_email, market, organization)
    if user_role is None:
        return False

    return ROLE_RANK[user_role] >= ROLE_RANK[required_role]


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
    user = UsersApi.get_user(user_email)
    if not user:
        return []
    user_id = user.id
    org_dicts = organizations_collection.find({
        "$or": [
            {"owner": user_id},
            {"admins": user_id},
            {"members": user_id}
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
