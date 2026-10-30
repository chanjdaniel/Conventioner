"""Single owner of the ``history`` collection: every change on a market, who made it, and when.

**One history for every change** (E40, ADR 0017). It began as the placement history, which kept
placements only; Daniel widened it ("every change is logged", Q23), so every write that changes a
market, its applications or its vendors records here, after its change has landed (E40/F01/S02;
``tests/test_every_write_records.py`` sends each), and the placement trail is this history narrowed
to placements. What is state stays where it is - an application's verdict, the market's
``phaseHistory`` - and its changes are recorded here as well. The deletion trail (``deletion_trail.py``) stays apart, because it
must outlive what it describes and this history is deleted with its market.

**An organization's own changes are recorded here too** (E40/F02/S01): its people, its name,
ownership handed on and a market created in it, each an entry keyed by ``organization_id`` in
place of ``market_id``, read in Manage organization and deleted with the organization. Its kinds
for the organization's default rows wait for E39/F02/S01 to write them.

**An entry says what happened, never a sentence**: the ``E39`` action it was
(``api.market_actions``, so the verb that asked "may this person" is the one recorded), a finer
kind where one action covers several changes, the vendors it is about, whatever else it is about,
and a structured detail. The wording belongs to whichever surface shows it
(``front-end/src/utils/marketHistory.ts`` for the whole history, ``placementHistory.ts`` for the
drawer's placements) and must be changeable without a migration - the same rule
``placement_reasons`` follows.

**A run is one entry**, not none and not one per placement. Omitting runs would leave the history
lying by omission, because a placement that changed between two hand edits would have no
explanation. One entry per placement would drown the hand edits under machine rows, and the hand
edits are the entries anyone actually reads.

**Deliberate, not incidental:** recording *who* attaches an organizer's identity to a market that
may be exported, shared, or handed to a successor organizer. That was weighed and accepted for the
placements (readable-journey ticket 08) and widened to every change on Daniel's word (Q23).

Storage contract: documents are persisted snake_case with the market foreign key ``market_id``,
matching ``applications`` rather than ``markets`` - or, for an organization's own change,
``organization_id`` - and, like applications, every reader and writer goes through this module.
A market's history is deleted with the market, and an organization's with the organization.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple, Union

from api.market_actions import ASSIGN, CHANGE_THE_TABLE, Action
from db_config import get_database
from utils.email_address import normalized_email

logger = logging.getLogger(__name__)

HISTORY_COLLECTION = "history"
MARKET_ID_FIELD = "market_id"
ORGANIZATION_ID_FIELD = "organization_id"
# The placement history's old collection, read beside ``history`` until every database has run
# ``migrations/migrate_placement_history.py``; a later release removes it (ADR 0017).
LEGACY_PLACEMENT_COLLECTION = "placement_history"

db = get_database()
history_collection = db[HISTORY_COLLECTION]
legacy_placement_collection = db[LEGACY_PLACEMENT_COLLECTION]

#: The one verb no row of the table asks: an applicant submitting or editing their own
#: application, whose sign-in is the check.
APPLY = "apply"

# What a change was, where one action covers several: kinds rather than a message, as for the
# placements below, so a surface words them. ``docs/implementation/data/history.md`` lists each
# with its subject and detail.
RENAMED = "renamed"
PLAN = "plan"
PRICING = "pricing"
FLOORPLAN = "floorplan"
FLOORPLAN_IMAGE_DELETED = "floorplan_image_deleted"
FORM = "form"
REVIEW_HIGHLIGHTS = "review_highlights"
REJECTION_RULES = "rejection_rules"
IMPORTED = "imported"
STARTED = "started"
VERDICT = "verdict"
VERDICTS = "verdicts"
FOLLOW_UP_OWNER = "follow_up_owner"
NOTE = "note"
REQUEST_HANDLED = "request_handled"
RULES = "rules"
CHECKED_IN = "checked_in"
CHECK_IN_UNDONE = "check_in_undone"
ROLE_GIVEN = "role_given"
ROLE_CHANGED = "role_changed"
ROLE_TAKEN = "role_taken"
SUBMITTED = "submitted"
EDITED = "edited"
PERMISSION_SET = "permission_set"
PERMISSION_RESET = "permission_reset"
PERMISSION_TABLE_RESET = "permission_table_reset"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


#: Part of an entry, given as it is or as a builder: a callable with no arguments, run inside
#: ``record``'s guard.
Part = Union[Dict[str, Any], None, Callable[[], Optional[Dict[str, Any]]]]


def record(
    market_id: str, actor: Optional[str], action: Action, *, kind: Optional[str] = None,
    vendors: Iterable[str] = (), subject: Part = None, detail: Part,
) -> None:
    """Write one entry. Never raises: a history that can break a change is worse than no history.

    The write that matters has already happened by the time this is called - the seat is taken,
    and check-in will read it. Failing the request because the *record* of it could not be saved
    would tell the organizer their change did not land when it did. So the subject and the detail
    are given as builders wherever building them reads or computes anything, and are built here,
    under the same guard as the insert: a detail that raised before it got here would answer the
    change with a 500 after it landed as surely as a failed insert would.

    A detail that builds to None is a write that changed nothing, and records nothing.
    """
    _write({MARKET_ID_FIELD: market_id}, actor, action.id, kind, vendors, subject, detail)


def record_applicant(
    market_id: str, applicant: str, kind: str, application_id: str, detail: Part,
) -> None:
    """An applicant's own change to their application, with the applicant as its actor.

    No row of the table asks it - the applicant holds no role, and their sign-in is the check - so
    its action is the history's own ``apply``.
    """
    _write({MARKET_ID_FIELD: market_id}, applicant, APPLY, kind, [applicant],
           {"application_id": application_id}, detail)


def _built(part: Part) -> Optional[Dict[str, Any]]:
    return part() if callable(part) else part


def _write(
    owner: Dict[str, str], actor: Optional[str], action_id: str, kind: Optional[str],
    vendors: Iterable[str], subject: Part, detail: Part,
) -> None:
    """Write one entry of the market or the organization ``owner`` names, by its key."""
    try:
        built = _built(detail)
        if built is None:
            return
        history_collection.insert_one({
            "id": str(uuid.uuid4()),
            **owner,
            "actor": actor,
            "at": _now(),
            "action": action_id,
            "kind": kind,
            # Lowercased, because an address is a person and case is not part of who they are:
            # a vendor's entries are looked up by this list.
            "vendors": [normalized_email(email) for email in vendors if email],
            "subject": _built(subject) or {},
            "detail": built,
        })
    except Exception as e:
        # The error's type and the entry's ids, never its text: a driver's message can quote the
        # document it refused, and an entry holds answers and addresses.
        [(key, owner_id)] = owner.items()
        logger.warning("Could not record %s on %s %s: %s", kind or action_id,
                       "market" if key == MARKET_ID_FIELD else "organization", owner_id,
                       type(e).__name__)


def changes(before: Dict[str, Any], after: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """An entry's detail: the fields that differ, as they were and as they are, or None when
    nothing does - so a write that restates what is stored records nothing.

    Never a whole document: a field the write left as it was is in neither half.
    """
    changed = [key for key in {**before, **after} if before.get(key) != after.get(key)]
    if not changed:
        return None
    return {
        "before": {key: before.get(key) for key in changed},
        "after": {key: after.get(key) for key in changed},
    }


def delete_for_market(market_id: str) -> int:
    """Take a market's history with the market. Returns how many entries went.

    Its entries not yet moved out of ``placement_history`` go too, or the migration would carry
    them into the history of a market that no longer exists.
    """
    query = {MARKET_ID_FIELD: market_id}
    return (
        history_collection.delete_many(query).deleted_count
        + legacy_placement_collection.delete_many(query).deleted_count
    )


def _vendor_query(query: Dict[str, Any], vendor: Optional[str]) -> Dict[str, Any]:
    if vendor:
        query["vendors"] = normalized_email(vendor)
    return query


def _newest_first(entries: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(entries, key=lambda entry: entry.get("at") or "", reverse=True)


# --- Placements: the ``assign`` action's seat changes, and the trail the drawer reads ---------

# What happened to a seat. Kinds rather than a message, so a surface can word it, group it or
# filter by it without parsing prose.
PLACED = "placed"
FREED = "freed"
SWAPPED = "swapped"
ASSIGNED = "assigned"
PLACEMENT_KINDS = (PLACED, FREED, SWAPPED, ASSIGNED)

# The fields a placement entry carried before the history widened, and all the placement endpoint
# answers with, so the drawer's History tab reads exactly what it always did.
_PLACEMENT_FIELDS = ("id", MARKET_ID_FIELD, "actor", "at", "kind", "vendors", "detail")


def placement_subject(kind: str, detail: Dict[str, Any]) -> Dict[str, Any]:
    """The table-day a placement entry is about, read from its detail; a run is about the market.

    Shared with ``migrations/migrate_placement_history.py``, so an entry moved from the old trail
    names its subject exactly as one written since.
    """
    if kind == SWAPPED:
        tables = [seat.get("table_code") for seat in detail.get("seats") or []]
    elif kind in (PLACED, FREED):
        tables = [detail.get("table_code")]
    else:
        return {}
    return {"date": detail.get("date"), "table_codes": tables}


def _record_placement(
    market_id: str, actor: str, kind: str, vendors: List[str], detail: Dict[str, Any]
) -> None:
    record(
        market_id, actor, ASSIGN, kind=kind, vendors=vendors,
        subject=lambda: placement_subject(kind, detail), detail=detail,
    )


def record_placed(market_id: str, actor: str, placement, left=None) -> None:
    """One vendor put in one seat by hand, and the seat they ``left`` on that date: ``before``,
    null when they had none. Entries older than ``before`` carry no such key."""
    _record_placement(market_id, actor, PLACED, [placement.email], {
        "date": placement.date,
        "table_code": placement.table_code,
        "table_choice": placement.table_choice,
        "before": {"table_code": left.table_code, "table_choice": left.table_choice}
        if left is not None else None,
    })


def record_freed(market_id: str, actor: str, email: str, date: str, table_code: str) -> None:
    """One seat emptied. Recorded even though nobody was placed: it is what a vendor dropping out
    looks like, and the question "where did they go" is asked about exactly this."""
    _record_placement(market_id, actor, FREED, [email], {"date": date, "table_code": table_code})


def record_swapped(market_id: str, actor: str, date: str, first, second) -> None:
    """Two vendors traded seats - ONE entry, because it was one action."""
    _record_placement(market_id, actor, SWAPPED, [first.email, second.email], {
        "date": date,
        "seats": [
            {"email": first.email, "table_code": first.table_code},
            {"email": second.email, "table_code": second.table_code},
        ],
    })


def record_assignment_run(
    market_id: str, actor: str, placements_written: int, pins_preserved: int
) -> None:
    """One entry for the whole run, naming who pressed it and what it touched."""
    _record_placement(market_id, actor, ASSIGNED, [], {
        "placements_written": placements_written,
        "pins_preserved": pins_preserved,
    })


def placement_entries(market_id: str, vendor: Optional[str] = None) -> List[Dict[str, Any]]:
    """The placement trail: this market's history narrowed to placements, newest first, each entry
    in the shape it had before the history widened.

    Until a database has run ``migrations/migrate_placement_history.py``, its older entries are
    still in ``placement_history``, so they are read from there too: without them, between the
    deploy and the migration, a vendor's History tab would say nobody changed a placement someone
    did. An entry can be in both for a moment - the migration writes each one to ``history``
    before it deletes it from the old collection, and a run can stop between the two - so an old
    entry whose id ``history`` already holds is left out.
    """
    query = _vendor_query(
        {MARKET_ID_FIELD: market_id, "kind": {"$in": list(PLACEMENT_KINDS)}}, vendor,
    )
    projection = {"_id": 0, **{field: 1 for field in _PLACEMENT_FIELDS}}
    moved = list(history_collection.find({**query, "action": ASSIGN.id}, projection))
    moved_ids = {entry.get("id") for entry in moved}
    return _newest_first([
        *moved,
        *(entry for entry in legacy_placement_collection.find(query, projection)
          if entry.get("id") not in moved_ids),
    ])


# --- Reading the whole history, a page at a time (E40/F01/S03) -------------------------------

#: How many entries one page holds: the newest, then as many again each time more are asked for.
#: Ten, so the History section stays a short read inside Manage market (Daniel, on T110's review).
PAGE_SIZE = 10

# Everything an entry holds but its storage keys: the market is the one asked for.
_ENTRY_PROJECTION = {"_id": 0, MARKET_ID_FIELD: 0}

# Newest first, and by id within one instant, so a page boundary between two entries written in
# the same instant neither loses nor repeats either. The lookup index on (market_id, at, id) is
# this order read backwards, so Mongo walks one page of index keys and stops.
_NEWEST_FIRST = [("at", -1), ("id", -1)]

_CURSOR_SEPARATOR = "|"


def _cursor(entry: Dict[str, Any]) -> str:
    return f"{entry.get('at') or ''}{_CURSOR_SEPARATOR}{entry.get('id') or ''}"


def parse_cursor(cursor: str) -> Optional[Tuple[str, str]]:
    """The entry a page starts after, as ``entries_page`` handed it out, or None when the text is
    not a cursor."""
    at, separator, entry_id = (cursor or "").rpartition(_CURSOR_SEPARATOR)
    if not separator or not at or not entry_id:
        return None
    return at, entry_id


def _sort_key(entry: Dict[str, Any]) -> Tuple[str, str]:
    return entry.get("at") or "", entry.get("id") or ""


def _page_query(
    market_id: str, before: Optional[Tuple[str, str]], actor: Optional[str],
    vendor: Optional[str], since: Optional[str], until: Optional[str],
) -> Dict[str, Any]:
    clauses: List[Dict[str, Any]] = [_vendor_query({MARKET_ID_FIELD: market_id}, vendor)]
    if actor:
        clauses.append({"actor": actor})
    if since:
        clauses.append({"at": {"$gte": since}})
    if until:
        clauses.append({"at": {"$lt": until}})
    if before:
        clauses.append(_before_clause(before))
    return clauses[0] if len(clauses) == 1 else {"$and": clauses}


def _before_clause(before: Tuple[str, str]) -> Dict[str, Any]:
    """The entries after the one ``before`` names, in the newest-first order."""
    at, entry_id = before
    return {"$or": [{"at": {"$lt": at}}, {"at": at, "id": {"$lt": entry_id}}]}


def entries_page(
    market_id: str, *, before: Optional[Union[str, Tuple[str, str]]] = None,
    limit: int = PAGE_SIZE, actor: Optional[str] = None, actions: Optional[List[str]] = None,
    vendor: Optional[str] = None, since: Optional[str] = None, until: Optional[str] = None,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """One page of the market's history, newest first, and the cursor to the page after it, or
    None when it is the last.

    Narrowed to one ``actor``, to entries whose action is one of ``actions`` (a group of the
    table), to the entries naming one ``vendor``, and to ``since <= at < until`` (instants in this
    module's ``at`` format). Never more than ``PAGE_SIZE`` entries: a market's history has no
    limit, and its reader asks again for more.

    Until a database has run the move from ``placement_history``, its older placements are read
    beside the history, as the placement trail reads them, so the history does not seem to start
    where the migration has not run yet.
    """
    if isinstance(before, str):
        before = parse_cursor(before)
    limit = max(1, min(limit, PAGE_SIZE))
    query = _page_query(market_id, before, actor, vendor, since, until)
    wanted = limit + 1

    def page_of(collection, narrowed):
        return list(collection.find(narrowed, _ENTRY_PROJECTION).sort(_NEWEST_FIRST).limit(wanted))

    entries = page_of(
        history_collection, {"$and": [query, {"action": {"$in": actions}}]} if actions else query)
    if actions is None or ASSIGN.id in actions:
        moved_ids = {entry.get("id") for entry in entries}
        for old in page_of(legacy_placement_collection, query):
            if old.get("id") in moved_ids:
                continue
            old["action"] = ASSIGN.id
            old["subject"] = placement_subject(old.get("kind"), old.get("detail") or {})
            entries.append(old)
        entries.sort(key=_sort_key, reverse=True)
        entries = _once_each(entries)[:wanted]

    if len(entries) > limit:
        return entries[:limit], _cursor(entries[limit - 1])
    return entries, None


def _once_each(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """An entry in both collections at once, as the migration can leave one, read once."""
    seen = set()
    once = []
    for entry in entries:
        if entry.get("id") in seen:
            continue
        seen.add(entry.get("id"))
        once.append(entry)
    return once


def actors(market_id: str) -> List[str]:
    """Who has changed something on this market, as an organizer: the people the history can be
    narrowed to. An applicant's own change is found by the vendor it names, and a check-in from
    the public page names nobody. The placements not yet moved out of ``placement_history`` are
    read too, as the pages read them, or their organizers could be read but not chosen."""
    found = {
        *history_collection.distinct(
            "actor", {MARKET_ID_FIELD: market_id, "action": {"$ne": APPLY}}),
        *legacy_placement_collection.distinct("actor", {MARKET_ID_FIELD: market_id}),
    }
    return sorted(actor for actor in found if actor)


# --- The table: a market owner's changes to who may do what (E39/F01/S03) -------------------

_PERMISSION_FIELDS = ("id", MARKET_ID_FIELD, "actor", "at", "action", "kind", "subject", "detail")


def permission_entries(market_id: str) -> List[Dict[str, Any]]:
    """This market's history narrowed to the changes to its table, newest first."""
    query = {MARKET_ID_FIELD: market_id, "action": CHANGE_THE_TABLE.id}
    projection = {"_id": 0, **{field: 1 for field in _PERMISSION_FIELDS}}
    return _newest_first(history_collection.find(query, projection))


# --- The organization's own changes (E40/F02/S01) ------------------------------------------
#
# An organization has no table of its own: who may change it is its owner's and its admins' rule
# (``api.organizations``). So its actions are the history's own verbs, one per kind of change, as
# ``apply`` is for an applicant; a market's are the table's rows. The kinds are the market's where
# the change is the same: a person given, changed or taken a role, a name changed, a row set.

#: Renaming the organization; its kind is ``renamed``, as a market's rename is.
CHANGE_ORGANIZATION = "change-organization"
#: An admin added, removed, or a member made one: ``role_given``, ``role_changed``, ``role_taken``.
MANAGE_ORGANIZATION_ADMINS = "manage-organization-admins"
#: A member added or removed: ``role_given``, ``role_taken``.
MANAGE_ORGANIZATION_MEMBERS = "manage-organization-members"
#: Ownership handed to someone else, one entry for the one act; no kind.
TRANSFER_ORGANIZATION = "transfer-organization"
#: A market created in the organization, which starts its own history empty; no kind.
CREATE_MARKET = "create-market"
#: A row of the organization's default table set or reset, ``permission_set`` and
#: ``permission_reset`` with the market's subject and detail (E39/F02/S01 writes it).
CHANGE_THE_DEFAULT = "change-the-default"


def record_for_organization(
    organization_id: str, actor: Optional[str], action_id: str, *, kind: Optional[str] = None,
    subject: Part = None, detail: Part,
) -> None:
    """Write one entry of an organization's own history. Never raises, as ``record`` never does:
    the change it records has already landed."""
    _write({ORGANIZATION_ID_FIELD: organization_id}, actor, action_id, kind, (), subject, detail)


def delete_for_organization(organization_id: str) -> int:
    """Take an organization's own history with the organization. Returns how many entries went.

    Its markets' histories go with each market, as it is deleted; the deletion trail, which
    outlives both, records what went.
    """
    return history_collection.delete_many({ORGANIZATION_ID_FIELD: organization_id}).deleted_count


_ORGANIZATION_ENTRY_PROJECTION = {"_id": 0, ORGANIZATION_ID_FIELD: 0}


def organization_entries_page(
    organization_id: str, *, before: Optional[Union[str, Tuple[str, str]]] = None,
    limit: int = PAGE_SIZE,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """One page of an organization's own history, newest first, and the cursor to the page after
    it, or None when it is the last: the market's paging, on the (organization_id, at, id) index."""
    if isinstance(before, str):
        before = parse_cursor(before)
    limit = max(1, min(limit, PAGE_SIZE))
    clauses: List[Dict[str, Any]] = [{ORGANIZATION_ID_FIELD: organization_id}]
    if before:
        clauses.append(_before_clause(before))
    query = clauses[0] if len(clauses) == 1 else {"$and": clauses}
    entries = list(history_collection.find(query, _ORGANIZATION_ENTRY_PROJECTION)
                   .sort(_NEWEST_FIRST).limit(limit + 1))
    if len(entries) > limit:
        return entries[:limit], _cursor(entries[limit - 1])
    return entries, None
