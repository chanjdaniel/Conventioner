"""
Organization API functions for CRUD operations and role management.
"""
import uuid
from typing import Optional, Dict, Any, List
from pymongo.results import UpdateResult, DeleteResult
from bson import ObjectId
from datatypes import MarketPhase, Organization, market_name_slug, phase_from_market_document, phase_label
from db_config import get_database
from market_documents import market_doc_filter, market_doc_key
import deletion_trail as DeletionTrail
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


# ── Deleting an organization is safe (E20/F04/S01) ───────────────────────────────────────────
#
# Owner-only was the AUTHORITY rule and stays. This is the SAFETY rule it never had: deleting an
# organization used to set every one of its markets to belong to nothing, which is a state the
# create endpoint refuses to produce - `POST /markets` rejects a payload with no organization -
# and which made those markets invisible to everyone who reached them through it.
#
# The partition is by phase, and it lives HERE rather than in the transition guard registry: that
# registry is validated against the transition table and is for transitions, and this is not one.

# A market in any of these is mid-lifecycle: somebody is applying, being reviewed, being placed,
# or trading today. Deleting the organization under it destroys work in progress, so it refuses.
BLOCKING_PHASES: frozenset[str] = frozenset({
    MarketPhase.APPLICATIONS_OPEN.value,
    MarketPhase.APPLICATIONS_CLOSED.value,
    MarketPhase.REVIEW.value,
    MarketPhase.ASSIGNMENT.value,
    MarketPhase.OFFERS.value,
    MarketPhase.MARKET_DAYS.value,
})


def _market_summary(document: Dict[str, Any]) -> Dict[str, Any]:
    """What this market is, in the terms the confirmation has to say out loud.

    A COUNT of markets does not let an organizer decide. The name, the phase, whether it ran and
    how many placements it holds are what tell a forgotten draft apart from the record of a market
    that actually happened - and the slug is the public URL that stops resolving.
    """
    phase = phase_from_market_document(document)
    assignment = document.get(market_doc_key("assignment_object")) or {}
    placements = assignment.get(market_doc_key("vendor_assignments")) or []
    name = document.get("name") or ""
    return {
        "id": document.get("id"),
        "name": name,
        "phase": phase.value,
        "phase_label": phase_label(phase),
        # Archived is the phase a market reaches by being published, so an archived market with
        # placements is one that ran. Said plainly rather than left to be inferred from a phase.
        "ran": phase == MarketPhase.ARCHIVED and bool(placements),
        "placements": len(placements),
        # Only a published market has a public URL at all; a draft's slug resolves to nothing.
        "public_slug": document.get("slug") or market_name_slug(name)
        if phase != MarketPhase.DRAFT
        else None,
    }


def organization_deletion_preview(org_id: str, requesting_user_email: str) -> Dict[str, Any]:
    """What deleting this organization would destroy, and what would refuse it.

    Read-only, and the confirmation dialog's whole content. It is a separate call rather than a
    field on the organization because it counts placements across every market the organization
    holds, which no list of organizations should pay for.
    """
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise ValueError("Organization not found")

    requesting_user = UsersApi.get_user(requesting_user_email)
    if not requesting_user:
        raise PermissionError("User not found")
    if org.get("owner") != requesting_user.id:
        raise PermissionError("Only organization owner can delete organization")

    summaries = [
        _market_summary(document)
        for document in markets_collection.find(market_doc_filter("organization_id", org_id))
    ]
    blocking = [m for m in summaries if m["phase"] in BLOCKING_PHASES]
    doomed = [m for m in summaries if m["phase"] not in BLOCKING_PHASES]

    return {
        "organization_id": org_id,
        "organization_name": org.get("name"),
        "can_delete": not blocking,
        "blocking_markets": blocking,
        "markets_to_delete": doomed,
    }


class OrganizationHasLiveMarkets(Exception):
    """Deletion refused: the organization holds markets that are mid-lifecycle.

    Carries them, because "you cannot delete this" without saying which markets is a refusal an
    organizer can only answer by guessing.
    """

    def __init__(self, blocking: List[Dict[str, Any]]):
        self.blocking = blocking
        names = ", ".join(f"{m['name']} ({m['phase_label']})" for m in blocking)
        super().__init__(
            f"This organization still holds {len(blocking)} market"
            f"{'' if len(blocking) == 1 else 's'} that {'is' if len(blocking) == 1 else 'are'} "
            f"under way: {names}. Archive or delete them first."
        )


def delete_organization(org_id: str, requesting_user_email: str) -> DeleteResult:
    """Delete an organization, and the drafts and archived markets it holds. Only owner can delete.

    **No market is ever left belonging to nothing.** The update that set `organizationId` to null
    is gone outright rather than kept as a fallback: a fallback would preserve the exact state this
    exists to prevent.
    """
    preview = organization_deletion_preview(org_id, requesting_user_email)
    if not preview["can_delete"]:
        raise OrganizationHasLiveMarkets(preview["blocking_markets"])

    org = organizations_collection.find_one({"id": org_id})

    # The trail is written BEFORE anything is destroyed, and is allowed to fail the whole
    # operation: an organization deleted with no record of what went with it is the thing this
    # story added a trail for.
    DeletionTrail.record_organization_deletion(
        org, preview["markets_to_delete"], requesting_user_email
    )

    for market in preview["markets_to_delete"]:
        markets_collection.delete_one({"id": market["id"]})

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
