"""
Permission resolution and access control functions.
"""
from typing import Any, Callable, Iterable, List, NamedTuple, Optional
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


def get_user_market_role(
    user_email: str, market: Market, organization: Optional[Organization] = None, user: Any = None,
) -> Optional[MarketRole]:
    """
    Get user's effective role for a market: the higher of their role on the market itself
    (``market.roles``, keyed by user id) and what their place in its organization gives
    (``organization_market_role``). Returns None if user has no access.

    ``user`` is their account when the caller already holds it, so it is not read again.
    """
    if user is None:
        user = UsersApi.get_user(user_email)
    if not user:
        return None
    user_id = user.id

    if market.organization_id:
        if organization is None:
            org_dict = organizations_collection.find_one({"id": market.organization_id})
            if org_dict:
                org_dict.pop('_id', None)
                try:
                    organization = Organization(**org_dict)
                except Exception:
                    organization = None

    return market_role_of(user_id, market, organization)


def market_role_of(
    user_id: Optional[str], market: Market, organization: Optional[Organization],
) -> Optional[MarketRole]:
    """``get_user_market_role`` for someone already known by id, with the market's organization
    already loaded: the higher of their role on the market and what their place in the
    organization gives. ``organization`` None, or not the market's, counts the market's roles
    alone, as ``people_with_market_role`` does."""
    if not user_id:
        return None
    through_organization = None
    if organization is not None and organization.id == market.organization_id:
        through_organization = organization_market_role(
            user_id, organization.owner, organization.admins, organization.members)
    return higher_role((market.roles or {}).get(user_id), through_organization)


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
        if market_role_of(user_id, market, organization)
    ]


#: A person's place in an organization, as Manage market names it, by the role it gives on its
#: markets: ``admin`` for its owner and admins, who run them, ``member`` for a member, who reads them.
_PLACE_BY_ROLE = {MarketRole.ADMIN: "admin", MarketRole.VIEWER: "member"}


class Access(NamedTuple):
    """One person with access to a market, as Manage market lists them (E38/F12/S01)."""
    user_id: str
    email: str
    #: The role that counts: the higher of the market's own and the organization's.
    role: MarketRole
    #: The role the market itself gives them, or None.
    market_role: Optional[MarketRole]
    #: Their place in the market's organization (``_PLACE_BY_ROLE``), or None.
    organization_role: Optional[str]
    #: Whether the role that counts is the organization's: what it gives reaches the market's own,
    #: so a market role beside it, a tie included, adds nothing while they hold their place.
    from_organization: bool


def people_with_access(
    market: Market, organization: Optional[Organization], with_organization: bool,
    email_of: Callable[[str], Optional[str]],
) -> List[Access]:
    """Everyone with a role on the market, each once, at the role that counts (E38/F12/S01): the
    owner first, then Admin, Editor and Viewer, then by address, so no screen ranks a role.

    ``with_organization`` takes in the market's organization: its owner, admins and members, by
    ``people_with_market_role``, each at the higher of the two roles and with their place in it.
    Without it, the market's own roles alone, each as held and with no place named, so a reader
    who may not see the organization's people learns nothing of them. ``email_of`` answers an
    account's address by user id, or None for an account that is gone, which is left out.
    """
    roles = market.roles or {}
    of_the_organization = (
        with_organization and organization is not None
        and organization.id == market.organization_id)
    people = []
    for user_id in (
            people_with_market_role(market, organization) if of_the_organization else roles):
        email = email_of(user_id)
        market_role = roles.get(user_id)
        if not email:
            continue
        if not of_the_organization:
            people.append(Access(user_id, email, market_role, market_role, None, False))
            continue
        given = organization_market_role(
            user_id, organization.owner, organization.admins, organization.members)
        place = _PLACE_BY_ROLE.get(given)
        from_organization = given is not None and (
            market_role is None or ROLE_RANK[given] >= ROLE_RANK[market_role])
        people.append(Access(
            user_id, email, higher_role(market_role, given), market_role, place,
            from_organization))
    return sorted(people, key=lambda person: (-ROLE_RANK[person.role], person.email))


def in_market_organization(
    market: Market, organization: Optional[Organization], user_id: Optional[str],
) -> bool:
    """Whether this person is the owner, an admin or a member of the market's organization."""
    return bool(
        user_id and organization is not None and organization.id == market.organization_id
        and organization_market_role(
            user_id, organization.owner, organization.admins, organization.members)
    )


def follow_up_owners_for(
    market: Market, organization: Optional[Organization], requester_id: Optional[str],
) -> List[str]:
    """The user ids a requester may hand a follow-up to: those they are offered, and no others.

    Someone in the market's organization is offered everyone ``people_with_market_role`` finds.
    Someone outside it, there by a role on the market alone, is offered only the people named in
    the market's roles, so the organization's addresses never reach them (decision/2026-10-22).
    """
    if in_market_organization(market, organization, requester_id):
        return people_with_market_role(market, organization)
    return list(market.roles or {})


def user_has_permission(user_email: str, market: Market, required_role: MarketRole, organization: Optional[Organization] = None) -> bool:
    """Whether the role this person holds is ``required_role`` or above it.

    Uses role hierarchy: Owner(4) > Admin(3) > Editor(2) > Viewer(1). A check never calls this
    with a role of its own: it asks its row in ``api.market_actions``, which calls this with the
    row's role (E39/F01/S01).
    """
    return role_reaches(get_user_market_role(user_email, market, organization), required_role)


def role_reaches(role: Optional[MarketRole], required_role: MarketRole) -> bool:
    """Whether a role already resolved is ``required_role`` or above it; holding none reaches none.

    The one ranking: ``user_has_permission`` ranks through it, and so does the table for a role a
    list resolved from the documents it holds (``market_actions.role_refusal``).
    """
    if role is None:
        return False
    return ROLE_RANK[role] >= ROLE_RANK[required_role]


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
