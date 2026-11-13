"""An organization's people, one map from user id to place (T283, ADR 0025), and its one writer.

An organization keeps its people as ``people``, ``{user_id: "owner" | "admin" | "member"}``, with
exactly one ``"owner"``, so a person has one place by construction. Until every stored organization
is folded into that map, one stored before it still holds only ``owner``, ``admins`` and
``members``, and is read by ``datatypes.organization_people_of``, its lists folded with the owner
winning.

This module builds the one filter that finds the organizations a person is in, ``of_person``, in
either shape; nothing else spells that query. ``people_key`` is the one spelling of a person's path
in the map.

It is also the only writer of a person's place: adding an admin or a member, the owner making an
admin a member or a member an admin (``change_place``), removing someone, transferring the
organization's ownership (``transfer``), and forgetting a deleted account. ``TABLE`` says what
each change does to the target's place as read, ``AUTHORITY`` who may ask for it, and
``next_people`` answers the map a change leaves, or its refusal, without a database. Each change is
then one conditional write (``_write``) that lands only on the places it judged: on an organization
with a map, the requester's and the target's keys as read; on one stored before the map, its three
lists as read, the write folding the map in. Transferring its ownership is one such write too,
filtered on the giver being owner, so no cut and no read finds an organization with two owners,
none, or an owner in a list. Every write keeps ``owner``, ``admins`` and ``members`` an exact
mirror of the map, for a rollback to the release before it. A write that meets a change answers 404
when the organization or the removed person is gone, else ``OrganizationChanged``, a 409; the person
decides again on what is true, as for a market (ADR 0024), and nothing is retried here.
"""
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, FrozenSet, Optional, Tuple, Type, Union

import api.users as UsersApi
from client_errors import (
    BadRequestError, ClientError, ConflictError, ForbiddenError, NotFoundError,
)
from datatypes import OrganizationRole, organization_people_of
from db_config import get_database

db = get_database()
organizations_collection = db["organizations"]
users_collection = db["users"]

OWNER = OrganizationRole.OWNER.value
ADMIN = OrganizationRole.ADMIN.value
MEMBER = OrganizationRole.MEMBER.value

#: The list each place below the owner is mirrored in.
_LIST_OF = {ADMIN: "admins", MEMBER: "members"}

NO_LONGER_IN_THE_ORGANIZATION = "They are no longer in this organization."
ORGANIZATION_CHANGED = (
    "This organization changed while you were working on it, so your change was not saved. "
    "Check its people as they are now, then make your change again."
)
ALREADY_AN_ADMIN = "They are already an admin of this organization."
ALREADY_A_MEMBER = "They are already a member of this organization."
THE_OWNERS_PLACE = (
    "The owner's place changes only when ownership of the organization is transferred.")
NOT_A_PLACE = "A place is admin or member."
ALREADY_OWNS_IT = "They already own this organization"
HAND_IT_ONLY_TO_ITS_PEOPLE = (
    "Transfer ownership only to one of the organization's admins or members.")
#: Said of removing the organization's owner. No screen transfers an organization's ownership yet
#: (organizations flow B6), so the sentence names no fix.
THE_OWNER_STAYS = "They own this organization, so they can't be removed from it."


class OrganizationChanged(ConflictError):
    """A change met another change to the same organization since it was read, and stored nothing:
    a 409, whose ``code`` the front end tells this refusal apart by, to re-read the organization."""

    def __init__(self):
        super().__init__(ORGANIZATION_CHANGED)

    def body(self) -> Dict[str, Any]:
        return {"error": ORGANIZATION_CHANGED, "code": "organization_changed"}


def _checked(user_id: Any) -> str:
    """A user id fit to be a key of the map and a part of a dotted path: a non-empty string with
    no ``.`` that does not start with ``$``. Any other is a programming error, never a client's:
    an id reaches here only from a stored account or the stored map, never from request text."""
    if not isinstance(user_id, str) or not user_id or "." in user_id or user_id.startswith("$"):
        raise RuntimeError(f"Not a user id to read an organization's people by: {user_id!r}")
    return user_id


def people_key(user_id: str) -> str:
    """The dotted path of this person's place in the people map."""
    return f"people.{_checked(user_id)}"


def of_person(user_id: str) -> Dict[str, Any]:
    """The filter for the organizations this person owns, administers or belongs to.

    An organization with ``people`` is found by the person's key in it, served by the
    ``people.$**`` wildcard index; one stored before the map, by any of its three lists, each
    indexed. An organization with ``people`` is never found by its lists, which only mirror it.
    """
    key = people_key(user_id)
    unfolded = {"people": {"$exists": False}}
    return {"$or": [
        {key: {"$exists": True}},
        {**unfolded, "owner": user_id},
        {**unfolded, "admins": user_id},
        {**unfolded, "members": user_id},
    ]}


# ── The table ────────────────────────────────────────────────────────────────────────────────


class Event(str, Enum):
    """A change to one person's place."""
    ADD_ADMIN = "add admin"
    ADD_MEMBER = "add member"
    REMOVE = "remove"
    CHANGE_TO_ADMIN = "change place to admin"
    CHANGE_TO_MEMBER = "change place to member"
    TRANSFER = "transfer to them"  # the requester, its owner, transfers ownership, becomes an admin
    FORGET = "forget"  # their account deleted


@dataclass(frozen=True)
class Refusal:
    """A change the table does not allow: the client error it answers, in these words."""
    error: Type[ClientError]
    sentence: str

    def refuse(self) -> None:
        raise self.error(self.sentence)


@dataclass(frozen=True)
class Move:
    """A change the table allows: the target's place after it (``None``, no place), and, when
    ``only_by`` is set, the requester's places it is allowed for, ``otherwise`` refusing the
    rest. ``requester_to``, when set, is the requester's own place after it: the transfer's giver
    becomes an admin."""
    to: Optional[str]
    only_by: FrozenSet[str] = frozenset()
    otherwise: Optional[Refusal] = None
    requester_to: Optional[str] = None


#: The place change each place a request may name asks for.
PLACE_CHANGES = {ADMIN: Event.CHANGE_TO_ADMIN, MEMBER: Event.CHANGE_TO_MEMBER}

#: An account deletion never reaches an owner: ``delete_user`` refuses one before it forgets them.
NEVER_REACHED = "never reached"

#: A place change is the owner's alone, whichever place it gives.
_THE_OWNERS_ALONE = (frozenset({OWNER}), Refusal(
    ForbiddenError, "Only the organization's owner can change someone's place in it."))

#: Who may ask for each change, by their place as read, and the refusal for anyone else. Checked
#: before the target's place. Forgetting is the account deletion's, with no requester.
AUTHORITY: Dict[Event, Tuple[FrozenSet[str], Refusal]] = {
    Event.ADD_ADMIN: (frozenset({OWNER}),
                      Refusal(ForbiddenError, "Only organization owner can add admins")),
    Event.ADD_MEMBER: (frozenset({OWNER, ADMIN}),
                       Refusal(ForbiddenError, "Only organization owner or admin can add members")),
    Event.REMOVE: (frozenset({OWNER, ADMIN}),
                   Refusal(ForbiddenError, "Only organization owner or admin can remove users")),
    Event.CHANGE_TO_ADMIN: _THE_OWNERS_ALONE,
    Event.CHANGE_TO_MEMBER: _THE_OWNERS_ALONE,
    Event.TRANSFER: (frozenset({OWNER}),
                     Refusal(ForbiddenError, "Only current owner can transfer ownership")),
}

#: What each change does, by the target's place as read (``None``, no place). "Add admin" of a
#: member makes them an admin, as Manage organization's "Add admin" field always has.
TABLE: Dict[Tuple[Event, Optional[str]], Union[Move, Refusal, str]] = {
    (Event.ADD_ADMIN, None): Move(ADMIN),
    (Event.ADD_ADMIN, MEMBER): Move(ADMIN),
    (Event.ADD_ADMIN, ADMIN): Refusal(BadRequestError, ALREADY_AN_ADMIN),
    (Event.ADD_ADMIN, OWNER): Refusal(BadRequestError, "Owner cannot be added as admin"),

    (Event.ADD_MEMBER, None): Move(MEMBER),
    (Event.ADD_MEMBER, MEMBER): Refusal(BadRequestError, ALREADY_A_MEMBER),
    (Event.ADD_MEMBER, ADMIN): Refusal(BadRequestError, "Admin cannot be added as member"),
    (Event.ADD_MEMBER, OWNER): Refusal(BadRequestError, "Owner cannot be added as member"),

    (Event.REMOVE, None): Refusal(NotFoundError, NO_LONGER_IN_THE_ORGANIZATION),
    (Event.REMOVE, MEMBER): Move(None),
    (Event.REMOVE, ADMIN): Move(None, only_by=frozenset({OWNER}),
                                otherwise=Refusal(ForbiddenError, "Only owner can remove admins")),
    (Event.REMOVE, OWNER): Refusal(BadRequestError, THE_OWNER_STAYS),

    # A place set to the place held is a Move to it, which writes and records nothing.
    (Event.CHANGE_TO_ADMIN, None): Refusal(NotFoundError, NO_LONGER_IN_THE_ORGANIZATION),
    (Event.CHANGE_TO_ADMIN, MEMBER): Move(ADMIN),
    (Event.CHANGE_TO_ADMIN, ADMIN): Move(ADMIN),
    (Event.CHANGE_TO_ADMIN, OWNER): Refusal(BadRequestError, THE_OWNERS_PLACE),

    (Event.CHANGE_TO_MEMBER, None): Refusal(NotFoundError, NO_LONGER_IN_THE_ORGANIZATION),
    (Event.CHANGE_TO_MEMBER, MEMBER): Move(MEMBER),
    (Event.CHANGE_TO_MEMBER, ADMIN): Move(MEMBER),
    (Event.CHANGE_TO_MEMBER, OWNER): Refusal(BadRequestError, THE_OWNERS_PLACE),

    # Ownership transferred to one of its people, who becomes its owner, the giver an admin.
    (Event.TRANSFER, None): Refusal(BadRequestError, HAND_IT_ONLY_TO_ITS_PEOPLE),
    (Event.TRANSFER, MEMBER): Move(OWNER, requester_to=ADMIN),
    (Event.TRANSFER, ADMIN): Move(OWNER, requester_to=ADMIN),
    (Event.TRANSFER, OWNER): Refusal(BadRequestError, ALREADY_OWNS_IT),

    (Event.FORGET, None): Move(None),
    (Event.FORGET, MEMBER): Move(None),
    (Event.FORGET, ADMIN): Move(None),
    (Event.FORGET, OWNER): NEVER_REACHED,
}


def may(people: Dict[str, str], event: Event, requester_id: Optional[str]) -> None:
    """Refuse the requester when their place as read does not allow ``event``."""
    if event is Event.FORGET:
        return
    allowed, refusal = AUTHORITY[event]
    if people.get(requester_id) not in allowed:
        refusal.refuse()


def next_people(
    people: Dict[str, str], event: Event, requester_id: Optional[str], target_id: str,
) -> Dict[str, str]:
    """The map ``event`` leaves, by ``requester_id`` on ``target_id``, or the client error the
    table answers. ``people`` is left as it was; a change that changes nothing answers it equal.

    The target keeps their position in the map's order when their place changes, and joins at its
    end when they had none; so does the requester when the change moves them too.
    """
    may(people, event, requester_id)
    place = people.get(target_id)
    cell = TABLE.get((event, place))
    if cell is None or cell == NEVER_REACHED:
        raise RuntimeError(f"No change {event.value!r} of a person whose place is {place!r}")
    if isinstance(cell, Refusal):
        cell.refuse()
    if cell.only_by and people.get(requester_id) not in cell.only_by:
        cell.otherwise.refuse()
    after = dict(people)
    if cell.to is None:
        after.pop(target_id, None)
    else:
        after[target_id] = cell.to
    if cell.requester_to is not None:
        after[requester_id] = cell.requester_to
    return after


# ── The writes ───────────────────────────────────────────────────────────────────────────────


def _mirror(people: Dict[str, str]) -> Dict[str, Any]:
    """The old lists as an exact mirror of ``people``, in its order: written whole when the write
    folds the map in. An organization with no owner keeps the ``owner`` it holds."""
    lists: Dict[str, Any] = {
        "admins": [user_id for user_id, place in people.items() if place == ADMIN],
        "members": [user_id for user_id, place in people.items() if place == MEMBER],
    }
    owners = [user_id for user_id, place in people.items() if place == OWNER]
    if owners:
        lists["owner"] = owners[0]
    return lists


def _moved(user_id: str, before: Optional[str], after: Optional[str]) -> Dict[str, Dict[str, Any]]:
    """The update that moves one person from ``before`` to ``after`` (``None``, no place) on a
    folded organization: their key set or unset, and the lists kept in step, no path touched twice.
    The owner's place is the transfer's, never moved here."""
    key = people_key(user_id)
    if OWNER in (before, after):
        raise RuntimeError(
            "The owner's place moves only when the organization's ownership is transferred")
    if after is None:
        return {"$unset": {key: ""}, "$pull": {"admins": user_id, "members": user_id}}
    update: Dict[str, Dict[str, Any]] = {"$set": {key: after},
                                         "$addToSet": {_LIST_OF[after]: user_id}}
    if before is not None:
        update["$pull"] = {_LIST_OF[before]: user_id}
    return update


def _handed_on(org: Dict[str, Any], giver: str, taker: str,
               taker_was: str) -> Tuple[Dict[str, Any], Dict[str, Dict[str, Any]]]:
    """What the transfer of the giver's organization to ``taker`` holds beyond both keys, and its
    update on a folded organization: both keys and ``owner`` set, and the lists kept in step, no
    path touched twice.

    From a member: they are pulled from ``members`` and the giver added to ``admins``. From an
    admin: ``admins`` is set to the list as read with the taker replaced by the giver where they
    stood, one path for both, so it is held as read, lest a change to it meanwhile be lost.
    """
    update: Dict[str, Dict[str, Any]] = {"$set": {
        people_key(giver): ADMIN, people_key(taker): OWNER, "owner": taker}}
    if taker_was == MEMBER:
        update["$pull"] = {"members": taker}
        update["$addToSet"] = {"admins": giver}
        return {}, update
    admins = org.get("admins")
    update["$set"]["admins"] = [giver if user_id == taker else user_id
                                for user_id in (admins if isinstance(admins, list) else [])
                                if user_id != giver]
    return {"admins": admins}, update


def _write(org: Dict[str, Any], people: Dict[str, str], after: Dict[str, str],
           requester_id: Optional[str], target_id: str) -> bool:
    """One conditional write of ``after`` over the organization read as ``org`` (its map as read,
    ``people``), landing only while the places it judged still hold. Answers whether it landed.

    With a map: the requester's and the target's keys as read are held, ``{"$exists": False}``
    where they had none, and, transferring ownership to an admin, ``admins`` as read. Stored before
    the map: ``people`` is held absent and the three lists equal to what was read, and the write sets
    the map whole beside the lists as its mirror, so the first change to such an organization also
    folds it.
    """
    if "people" in org:
        held = {people_key(user_id): people.get(user_id) or {"$exists": False}
                for user_id in (requester_id, target_id) if user_id is not None}
        if after.get(target_id) == OWNER:
            lists_held, update = _handed_on(org, requester_id, target_id, people[target_id])
        else:
            lists_held, update = {}, _moved(target_id, people.get(target_id), after.get(target_id))
        query = {"id": org["id"], **held, **lists_held}
    else:
        query, update = folding_write(org, after)
    return organizations_collection.update_one(query, update).matched_count > 0


def folding_write(org: Dict[str, Any],
                  people: Dict[str, str]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """The filter and update that write ``people`` into an organization stored before the map, read
    as ``org``: held on ``people`` absent and the three lists equal to what was read, setting the
    map whole beside the lists as its mirror. A change's write and the migration share it, so the
    first change to such an organization and the migration fold it alike."""
    for user_id in people:
        _checked(user_id)
    query = {"id": org["id"], "people": {"$exists": False},
             "owner": org.get("owner"), "admins": org.get("admins"),
             "members": org.get("members")}
    return query, {"$set": {"people": people, **_mirror(people)}}


def reconciling_write(org: Dict[str, Any],
                      people: Dict[str, str]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """The filter and update that rebuild a folded organization's ``people``, read as ``org``, from
    the lists the release before the map wrote while it ran after a rollback: held on the map and
    the three lists equal to what was read (a map equal only in the same key order, as read),
    setting the map whole beside the lists as its mirror. Only the migration's ``--reconcile``
    writes it, after a roll forward over such a rollback."""
    for user_id in people:
        _checked(user_id)
    query = {"id": org["id"], "people": org.get("people"),
             "owner": org.get("owner"), "admins": org.get("admins"),
             "members": org.get("members")}
    return query, {"$set": {"people": people, **_mirror(people)}}


def _met_a_change(org_id: str, event: Event, target_id: str) -> ClientError:
    """What a write that matched nothing answers, from one more read: the organization gone, a
    removed person already gone (which Manage organization reads as done), else the 409."""
    now = organizations_collection.find_one({"id": org_id})
    if not now:
        return NotFoundError("Organization not found")
    if event is Event.REMOVE and organization_people_of(now).get(target_id) is None:
        return NotFoundError(NO_LONGER_IN_THE_ORGANIZATION)
    return OrganizationChanged()


def _record_role(
    org_id: str, requesting_user_email: str, user_id: str,
    before: Optional[str], after: Optional[str],
) -> None:
    """A person given, changed or taken a place in the organization, under the admins' action
    when an admin is either side of it, as the market's role changes are recorded."""
    # Imported here: ``history`` reads ``api.market_actions``, which reads ``api.permissions``,
    # which reads this module's ``of_person``, so a module-level import is a cycle at boot.
    import history as History

    kind = (History.ROLE_GIVEN if before is None
            else History.ROLE_TAKEN if after is None else History.ROLE_CHANGED)
    action = (History.MANAGE_ORGANIZATION_ADMINS if ADMIN in (before, after)
              else History.MANAGE_ORGANIZATION_MEMBERS)

    def person() -> Dict[str, Any]:
        user = UsersApi.get_user_by_id(user_id)
        return {"user_id": user_id, "email": user.email if user else None}

    History.record_for_organization(
        org_id, requesting_user_email, action, kind=kind, subject=person,
        detail=lambda: History.changes({"role": before}, {"role": after}),
    )


def _requester(org_id: str, requesting_user_email: str) -> Tuple[Dict[str, Any], Any]:
    """The organization as read and the account asking: 404 for an organization nobody has, 403
    for an address with no account."""
    org = organizations_collection.find_one({"id": org_id})
    if not org:
        raise NotFoundError("Organization not found")
    requester = UsersApi.get_user(requesting_user_email)
    if not requester:
        raise ForbiddenError("User not found")
    return org, requester


def _judged_and_written(org: Dict[str, Any], event: Event, requester: Any,
                        target_id: str) -> Tuple[Optional[str], Optional[str]]:
    """Judge ``event`` on the organization as read and write it: the target's place before and
    after. A change that changes nothing writes nothing."""
    people = organization_people_of(org)
    after = next_people(people, event, requester.id, target_id)
    before_place, after_place = people.get(target_id), after.get(target_id)
    if before_place != after_place and not _write(org, people, after, requester.id, target_id):
        raise _met_a_change(org["id"], event, target_id)
    return before_place, after_place


def _change(org: Dict[str, Any], event: Event, requester: Any, target_id: str,
            requesting_user_email: str) -> None:
    """Judge ``event`` on the organization as read and write it, then keep the account's copy of
    its organizations and record it. A change that changes nothing writes and records nothing."""
    before_place, after_place = _judged_and_written(org, event, requester, target_id)
    if before_place == after_place:
        return
    # The account's own copy, best effort after the organization's write: no check reads it. A
    # place changed, rather than given or taken, leaves the copy as it was.
    if before_place is None or after_place is None:
        users_collection.update_one(
            {"id": target_id},
            {"$pull" if after_place is None else "$addToSet": {"organizations": org["id"]}},
        )
    _record_role(org["id"], requesting_user_email, target_id, before_place, after_place)


def _add(org_id: str, email: str, requesting_user_email: str, event: Event) -> None:
    org, requester = _requester(org_id, requesting_user_email)
    may(organization_people_of(org), event, requester.id)
    user = UsersApi.get_user(email)
    if not user:
        raise BadRequestError("User not found")
    _change(org, event, requester, user.id, requesting_user_email)


def add_admin(org_id: str, email: str, requesting_user_email: str) -> None:
    """Make the account at ``email`` an admin of the organization: the owner's to do. A member is
    made an admin; an admin, the owner, or an address with no account is refused."""
    _add(org_id, email, requesting_user_email, Event.ADD_ADMIN)


def add_member(org_id: str, email: str, requesting_user_email: str) -> None:
    """Make the account at ``email`` a member of the organization: its owner's or an admin's to
    do. A member, an admin, the owner, or an address with no account is refused."""
    _add(org_id, email, requesting_user_email, Event.ADD_MEMBER)


def remove(org_id: str, user_id: str, requesting_user_email: str) -> None:
    """Take this person's one place in the organization: the owner removes an admin or a member,
    an admin a member. Someone with no place in it, another organizer having removed them first,
    is a 404 saying so, written and recorded as nothing.

    ``user_id`` is the request's text: it reaches a path only once the stored map holds it.
    """
    org, requester = _requester(org_id, requesting_user_email)
    _change(org, Event.REMOVE, requester, user_id, requesting_user_email)


def change_place(org_id: str, user_id: str, place: Any, requesting_user_email: str) -> None:
    """Make this admin a member, or this member an admin: the owner's to do. ``place`` is the
    request's, ``"admin"`` or ``"member"``, refused as anything else before the organization is
    read. Setting the place held answers as done and writes nothing; someone with no place in it is
    a 404 saying so, and the owner's place is the transfer's, refused.

    ``user_id`` is the request's text: it reaches a path only once the stored map holds it.
    """
    event = PLACE_CHANGES.get(place) if isinstance(place, str) else None
    if event is None:
        raise BadRequestError(NOT_A_PLACE)
    org, requester = _requester(org_id, requesting_user_email)
    _change(org, event, requester, user_id, requesting_user_email)


def transfer(org_id: str, requesting_user_email: str, new_owner_email: str) -> None:
    """Transfer the organization's ownership to the account at ``new_owner_email``, one of its
    admins or members: its owner's to do, who stays on it as an admin. Transferring it to its own
    owner, to someone outside it, or to an address with no account is refused before anything is
    written.

    One write, filtered on the giver being owner and the new owner's place as read: an
    organization is never stored with two owners, none, or an owner in a list.
    """
    org, requester = _requester(org_id, requesting_user_email)
    may(organization_people_of(org), Event.TRANSFER, requester.id)
    new_owner = UsersApi.get_user(new_owner_email)
    if not new_owner:
        raise BadRequestError("New owner user not found")
    _judged_and_written(org, Event.TRANSFER, requester, new_owner.id)
    # The account's own copy, best effort after the organization's write, as for an add.
    users_collection.update_one({"id": new_owner.id}, {"$addToSet": {"organizations": org_id}})
    _record_transfer(org_id, requesting_user_email, requester, new_owner)


def _record_transfer(org_id: str, requesting_user_email: str, giver: Any, taker: Any) -> None:
    """The organization's ownership transferred, with its owner before and after."""
    import history as History  # Imported here, as in ``_record_role``.

    History.record_for_organization(
        org_id, requesting_user_email, History.TRANSFER_ORGANIZATION,
        subject={"user_id": taker.id, "email": taker.email},
        detail=lambda: History.changes({"owner": giver.email}, {"owner": taker.email}),
    )


def forget(user_id: str) -> None:
    """Take a deleted account's place in every organization it was an admin or a member of.

    Called after the account is deleted, which ``delete_user`` refuses an owner; an owner is
    matched by neither write, should one have become an owner in between.
    """
    key = people_key(user_id)
    lists = {"admins": user_id, "members": user_id}
    organizations_collection.update_many(
        {key: {"$in": [ADMIN, MEMBER]}}, {"$unset": {key: ""}, "$pull": lists})
    organizations_collection.update_many(
        {"people": {"$exists": False}, "$or": [{"admins": user_id}, {"members": user_id}]},
        {"$pull": lists})
