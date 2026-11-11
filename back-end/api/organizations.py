"""
Organization API functions for CRUD operations and role management.
"""
import uuid
from collections import Counter
from typing import Optional, Dict, Any, List
from pymongo.results import UpdateResult, DeleteResult
import api.market_actions as Actions
from assignment.utils import convert_keys_to_camel_case
from client_errors import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from datatypes import (
    MarketPhase,
    MarketRole,
    OrganizationRole,
    intake_mode_from_market_document,
    market_name_slug,
    organization_people_of,
    phase_from_market_document,
    phase_label,
)
from db_config import get_database
from market_documents import market_doc_field, market_doc_filter, market_doc_key
import deletion_trail as DeletionTrail
import history as History
import market_deletion as MarketDeletion
import organization_people as OrganizationPeople
import phase_record as PhaseRecord
import api.attendance as AttendanceApi
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
        raise BadRequestError("Organization already exists")
    
    # Verify owner exists and get user id
    owner = UsersApi.get_user(owner_email)
    if not owner:
        raise BadRequestError("Owner user not found")
    owner_id = owner.id
    
    org_id = str(uuid.uuid4())
    org_dict = {
        "id": org_id,
        "name": name,
        # Its people as one map (T283, ADR 0025), the lists beside it its mirror for one release.
        "people": {owner_id: OrganizationRole.OWNER.value},
        "owner": owner_id,
        "admins": [],
        "members": [],
        "markets": [],
        "theme": None
    }
    
    organizations_collection.insert_one(org_dict)
    
    # Add organization id to user's organizations list
    # By id: the account just loaded, however its owner's address was typed (E32/F03/S04).
    users_collection.update_one(
        {"id": owner_id},
        {"$addToSet": {"organizations": org_id}}
    )
    
    return org_id


def get_organization(org_id: str) -> Optional[Dict[str, Any]]:
    """Get an organization by id."""
    org = organizations_collection.find_one({"id": org_id})
    if org:
        org['_id'] = str(org['_id'])
    return org


def _what_removing_takes(org: Dict[str, Any]) -> Dict[str, Any]:
    """What Manage organization's Remove says a person loses (E38/F15/S01).

    ``marketCount``: the markets it holds, counted from the markets themselves, since its own
    ``markets`` list is kept in step only at best effort. ``marketsWithOwnRole``: for each admin and
    member who holds a role of their own on some of them, how many, since removing them from the
    organization leaves those roles, and so those markets.
    """
    documents = list(markets_collection.find(
        market_doc_filter("organization_id", org["id"]), {market_doc_key("roles"): 1}
    ))
    held = Counter(
        user_id for document in documents for user_id in (market_doc_field(document, "roles") or {})
    )
    people = [user_id for user_id, place in organization_people_of(org).items()
              if place != OrganizationRole.OWNER]
    return {
        "marketCount": len(documents),
        "marketsWithOwnRole": {user_id: held[user_id] for user_id in people if held[user_id]},
    }


def _people(user_ids: List[str], accounts: Dict[str, Any]) -> List[Dict[str, str]]:
    """Each of these people as ``{userId, email}``, in the stored order, an account that is gone
    left out (T204): served with its id, a row never borrows the next person's id when one is gone."""
    return [
        {"userId": user_id, "email": accounts[user_id].email}
        for user_id in user_ids if user_id in accounts
    ]


def organization_documents_of(user_id: str) -> List[Dict[str, Any]]:
    """The organizations this account owns, administers or belongs to, as stored, ``_id`` a string.

    The Markets list reads these alone: it needs an organization's id, name, people and rows, never
    the people's addresses or what removing them takes, which ``get_organizations_for_user`` adds.
    """
    orgs = list(organizations_collection.find(OrganizationPeople.of_person(user_id)))
    for org in orgs:
        org['_id'] = str(org['_id'])
    return orgs


def _placed(people: Dict[str, Any], place: OrganizationRole) -> List[str]:
    """The ids holding ``place`` in the map, in the map's order."""
    return [user_id for user_id, held in people.items() if held == place]


def get_organizations_for_user(user_email: str) -> List[Dict[str, Any]]:
    """Get all organizations where user is owner, admin, or member.

    Every owner, admin and member of all of them is read in one ``get_users_by_ids`` (T204), never
    one account at a time: the Organizations page and Manage organization make this read on open.

    Each is served with ``owner``, ``admins`` and ``members`` derived from its people map, in the
    map's order, whatever its stored lists hold (T283): a member made an admin is listed once.
    """
    user = UsersApi.get_user(user_email)
    if not user:
        return []
    user_id = user.id
    orgs = organization_documents_of(user_id)
    people_of = {org["id"]: organization_people_of(org) for org in orgs}
    accounts = UsersApi.get_users_by_ids(
        person_id for people in people_of.values() for person_id in people)

    result = []
    for org in orgs:
        people = people_of[org["id"]]
        owners = _placed(people, OrganizationRole.OWNER)
        org["owner"] = owners[0] if owners else None
        org["admins"] = _placed(people, OrganizationRole.ADMIN)
        org["members"] = _placed(people, OrganizationRole.MEMBER)
        owner = accounts.get(org.get("owner"))
        if owner:
            org["ownerEmail"] = owner.email
            org["owner_email"] = owner.email
        org["adminPeople"] = _people(org.get("admins", []), accounts)
        org["memberPeople"] = _people(org.get("members", []), accounts)
        # Deprecated (T204): the same people by address alone, for a tab still on the old bundle,
        # which pairs them with ``admins`` and ``members`` by position. The next release removes them.
        org["adminEmails"] = org["admin_emails"] = [p["email"] for p in org["adminPeople"]]
        org["memberEmails"] = org["member_emails"] = [p["email"] for p in org["memberPeople"]]
        # The rows it sets for the markets it will hold, each read as the markets copy it.
        org["defaultPermissionTable"] = Actions.default_table(org.get(DEFAULT_PERMISSIONS))
        org.update(_what_removing_takes(org))
        # Add user's role so frontend can show Manage button for owner/admin
        org["userRole"] = org["user_role"] = _role_in(org, user_id) or "member"
        result.append(org)
    
    return result


def update_organization(org_id: str, requesting_user_email: str, name: str) -> UpdateResult:
    """Rename an organization. Only owner can update.

    The name is the one field an owner edits: its owner, admins, members and markets change only
    through their own endpoints, which keep each user's ``organizations`` in step with them.
    """
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise NotFoundError("Organization not found")
    
    requesting_user = UsersApi.get_user(requesting_user_email)
    if not requesting_user:
        raise ForbiddenError("User not found")
    if _role_in(org, requesting_user.id) != OrganizationRole.OWNER:
        raise ForbiddenError("Only organization owner can update organization")
    
    result = organizations_collection.update_one(
        {"id": org_id},
        {"$set": {"name": name}}
    )
    History.record_for_organization(
        org_id, requesting_user_email, History.CHANGE_ORGANIZATION, kind=History.RENAMED,
        detail=lambda: History.changes({"name": org.get("name")}, {"name": name}),
    )
    return result


# ── The organization's own history (E40/F02/S01) ─────────────────────────────────────────────


def _role_in(org: Dict[str, Any], user_id: str) -> Optional[str]:
    """The person's place in the organization: ``owner``, ``admin``, ``member``, or None, read
    from its people map, or its old lists folded when it has none (T283)."""
    place = organization_people_of(org).get(user_id)
    return place if place in (OrganizationRole.OWNER, OrganizationRole.ADMIN,
                              OrganizationRole.MEMBER) else None


def _readable(org_id: str, requesting_user_email: str) -> Dict[str, Any]:
    """The organization, when the person asking is its owner, one of its admins or one of its
    members: 404 for one nobody has, 403 for one they are not in, as its other routes answer."""
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise NotFoundError("Organization not found")
    requesting_user = UsersApi.get_user(requesting_user_email)
    if not requesting_user or _role_in(org, requesting_user.id) is None:
        raise ForbiddenError("User does not belong to this organization")
    return org


def read_organization(org_id: str, requesting_user_email: str) -> Dict[str, Any]:
    """The organization's document, for its own people only.

    It answered anyone signed in who had its id, its people's ids among it.
    """
    org = _readable(org_id, requesting_user_email)
    if "_id" in org:
        org["_id"] = str(org["_id"])
    return org


def get_history(
    org_id: str, requesting_user_email: str, before: Optional[str] = None,
) -> Dict[str, Any]:
    """One page of the organization's own history, newest first, for Manage organization.

    Read by its owner, its admins and its members; anyone else is refused. ``before`` is the
    cursor the last page answered with. The first page also names the table's rows, for a change
    to the organization's default rows (E39/F02/S01), which no other read hands this dialog.
    """
    _readable(org_id, requesting_user_email)
    if before and History.parse_cursor(before) is None:
        raise BadRequestError("That page of the history could not be read.")

    entries, after = History.organization_entries_page(org_id, before=before or None)
    body: Dict[str, Any] = {
        # Only the entry's own fields are recased: its subject and detail are served as stored,
        # as the market's history serves them.
        "entries": [
            {**convert_keys_to_camel_case({k: v for k, v in entry.items()
                                           if k not in ("subject", "detail")}),
             "subject": entry.get("subject") or {}, "detail": entry.get("detail")}
            for entry in entries
        ],
        "next": after,
    }
    if not before:
        body["rowLabels"] = {row.id: row.label for row in Actions.ACTIONS.values()}
    return body


# ── The organization's default table (E39/F02/S01) ───────────────────────────────────────────
#
# The rows it sets for the markets it will hold, ``default_permissions`` on its document: row id to
# ``{role}``. A market created in it copies them (``api.markets.create_market``); a change reaches
# only the markets created after it. Its owner and its admins change it; its members read it.

DEFAULT_PERMISSIONS = "default_permissions"
NOT_THE_DEFAULTS_TO_CHANGE = (
    "Only the organization's owner or its admins may change its default permissions."
)
NO_SUCH_DEFAULT_ROW = "The default table has no such row."


def _default_to_change(org_id: str, requesting_user_email: str) -> Dict[str, Any]:
    """The organization whose default its owner or one of its admins is changing, or the refusal:
    404 for one nobody has, 403 for anyone else, its members included."""
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise NotFoundError("Organization not found")
    requesting_user = UsersApi.get_user(requesting_user_email)
    if not requesting_user or _role_in(org, requesting_user.id) not in ("owner", "admin"):
        raise ForbiddenError(NOT_THE_DEFAULTS_TO_CHANGE)
    return org


def _default_row(action_id: Any) -> Actions.Action:
    """The row of the default being changed: one the table has, and not fixed, as a market's."""
    row = Actions.ACTIONS.get(action_id) if isinstance(action_id, str) else None
    if row is None:
        raise BadRequestError(NO_SUCH_DEFAULT_ROW)
    if row.fixed:
        raise BadRequestError(Actions.fixed_row_refusal(row))
    return row


def _record_default(
    org_id: str, requesting_user_email: str, kind: str, subject: Dict[str, Any],
    detail: Dict[str, Any],
) -> None:
    History.record_for_organization(
        org_id, requesting_user_email, History.CHANGE_THE_DEFAULT, kind=kind, subject=subject,
        detail=detail,
    )


def set_default_permission(
    org_id: str, action_id: Any, role: Any, requesting_user_email: str,
) -> List[Dict[str, Any]]:
    """Set the role a row of the organization's default asks, as its owner or an admin.

    Setting the role the row already asks stores and records nothing. Returns the default table.
    """
    org = _default_to_change(org_id, requesting_user_email)
    row = _default_row(action_id)
    if not isinstance(role, str) or role not in {r.value for r in MarketRole}:
        raise BadRequestError(Actions.NOT_A_ROLE)

    stored = org.get(DEFAULT_PERMISSIONS)
    rows = Actions.organization_rows(stored)
    before = Actions.row_state(row, rows.get(row.id))
    if before["role"] == role:
        return Actions.default_table(stored)
    # Mongo cannot set a key inside a stored null or string, so a field that is not a map, which
    # is read as no rows set, is replaced by one holding this row.
    write = ({f"{DEFAULT_PERMISSIONS}.{row.id}": {"role": role}}
             if isinstance(stored, dict) or DEFAULT_PERMISSIONS not in org
             else {DEFAULT_PERMISSIONS: {row.id: {"role": role}}})
    organizations_collection.update_one({"id": org_id}, {"$set": write})
    after = {"role": role, "source": Actions.FROM_ORGANIZATION}
    _record_default(org_id, requesting_user_email, History.PERMISSION_SET, {"action": row.id},
                    {"before": before, "after": after})
    kept = dict(stored) if isinstance(stored, dict) else {}
    return Actions.default_table({**kept, row.id: {"role": role}})


def reset_default_permission(
    org_id: str, action_id: Any, requesting_user_email: str,
) -> List[Dict[str, Any]]:
    """Return a row of the organization's default to its built-in default, as its owner or an
    admin. A row it does not set records nothing. Returns the default table."""
    org = _default_to_change(org_id, requesting_user_email)
    row = _default_row(action_id)
    stored = org.get(DEFAULT_PERMISSIONS)
    rows = Actions.organization_rows(stored)
    if row.id not in rows:
        return Actions.default_table(stored)
    organizations_collection.update_one(
        {"id": org_id}, {"$unset": {f"{DEFAULT_PERMISSIONS}.{row.id}": ""}})
    _record_default(org_id, requesting_user_email, History.PERMISSION_RESET, {"action": row.id}, {
        "before": Actions.row_state(row, rows.get(row.id)), "after": Actions.row_state(row, None),
    })
    return Actions.default_table({k: v for k, v in stored.items() if k != row.id})


def reset_default_permissions(org_id: str, requesting_user_email: str) -> List[Dict[str, Any]]:
    """Return every row of the organization's default to its built-in default, as its owner or an
    admin: one write and one entry, as a market's whole table is reset. Returns the default table.

    Exactly the rows it reads are unset, so a row this build cannot read stays, as a market's does.
    """
    org = _default_to_change(org_id, requesting_user_email)
    stored = org.get(DEFAULT_PERMISSIONS)
    rows = Actions.organization_rows(stored)
    if not rows:
        return Actions.default_table(stored)
    held = [row for row in Actions.ACTIONS.values() if row.id in rows]
    organizations_collection.update_one({"id": org_id}, {"$unset": {
        f"{DEFAULT_PERMISSIONS}.{row.id}": "" for row in held
    }})
    _record_default(org_id, requesting_user_email, History.PERMISSION_TABLE_RESET, {}, {
        "before": {row.id: Actions.row_state(row, rows.get(row.id)) for row in held},
        "after": {row.id: Actions.row_state(row, None) for row in held},
    })
    return Actions.default_table({k: v for k, v in stored.items() if k not in rows})


def get_default_permission_history(org_id: str, requesting_user_email: str) -> List[Dict[str, Any]]:
    """Every change to the organization's default, newest first: who, when, the row, and its role
    before and after. Read by its owner, its admins and its members, as its history is."""
    _readable(org_id, requesting_user_email)
    return [convert_keys_to_camel_case(entry)
            for entry in History.default_permission_entries(org_id)]


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
    MarketPhase.APPLICATIONS.value,
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
    # Whether it ran is the phase record's to say (E26/F06/S03). Placements were read as proof,
    # and they are not: a market can be assigned and archived without ever being published.
    ran = (
        phase == MarketPhase.ARCHIVED
        and PhaseRecord.phases_reached(document, AttendanceApi.market_has_attendance).ran
    )
    return {
        "id": document.get("id"),
        "name": name,
        "phase": phase.value,
        "phase_label": phase_label(phase, intake_mode_from_market_document(document)),
        "ran": ran,
        "placements": len(placements),
        # Its vendor page is the one URL deleting it takes off the air that anyone was given: an
        # archived market keeps it as the record only if it ran (E26/F06/S02, ADR 0022), as the
        # rail shares it.
        "public_slug": (document.get("slug") or market_name_slug(name)) if ran else None,
    }


def organization_deletion_preview(org_id: str, requesting_user_email: str) -> Dict[str, Any]:
    """What deleting this organization would destroy, and what would refuse it.

    Read-only, and the confirmation dialog's whole content. It is a separate call rather than a
    field on the organization because it counts placements across every market the organization
    holds, which no list of organizations should pay for.
    """
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise NotFoundError("Organization not found")

    requesting_user = UsersApi.get_user(requesting_user_email)
    if not requesting_user:
        raise ForbiddenError("User not found")
    if _role_in(org, requesting_user.id) != OrganizationRole.OWNER:
        raise ForbiddenError("Only organization owner can delete organization")

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


class OrganizationHasLiveMarkets(ConflictError):
    """Deletion refused: the organization holds markets that are mid-lifecycle. A 409.

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

    def body(self) -> Dict[str, Any]:
        return convert_keys_to_camel_case({
            "error": "organization_has_live_markets",
            "message": self.message,
            "blocking_markets": self.blocking,
        })


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
        MarketDeletion.delete_market_and_records(markets_collection, market["id"])

    # Its own history goes with it, as each market's goes with the market; the trail above is
    # what outlives it.
    History.delete_for_organization(org_id)

    users_collection.update_many(
        {},
        {"$pull": {"organizations": org_id}}
    )

    return organizations_collection.delete_one({"id": org_id})


def add_org_admin(org_id: str, user_email: str, requesting_user_email: str) -> None:
    """Make someone an admin of the organization, as its owner (``organization_people``)."""
    OrganizationPeople.add_admin(org_id, user_email, requesting_user_email)


def add_org_member(org_id: str, user_email: str, requesting_user_email: str) -> None:
    """Make someone a member of the organization, as its owner or an admin
    (``organization_people``)."""
    OrganizationPeople.add_member(org_id, user_email, requesting_user_email)


def remove_org_user(org_id: str, user_id: str, requesting_user_email: str) -> None:
    """Take someone's place in the organization: the owner removes anyone but themselves, an
    admin a member (``organization_people``). Someone already gone is a 404 saying so, which
    Manage organization reads as done."""
    OrganizationPeople.remove(org_id, user_id, requesting_user_email)


def change_org_place(org_id: str, user_id: str, place: Any, requesting_user_email: str) -> None:
    """Make an admin a member or a member an admin, as the organization's owner
    (``organization_people``). Setting the place held writes nothing."""
    OrganizationPeople.change_place(org_id, user_id, place, requesting_user_email)


def transfer_org_ownership(org_id: str, current_owner_email: str, new_owner_email: str) -> None:
    """Hand the organization on to one of its admins or members, as its owner, who stays on it as
    an admin: one write (``organization_people``)."""
    OrganizationPeople.transfer(org_id, current_owner_email, new_owner_email)
