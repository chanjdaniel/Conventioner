"""Single owner of the ``history`` collection: every change on a market, who made it, and when.

**One history for every change** (E40, ADR 0017). It began as the placement history, which kept
placements only; Daniel widened it ("every change is logged", Q23), so every write that changes a
market, its applications or its vendors records here, after its change has landed (E40/F01/S02;
``tests/test_every_write_records.py`` sends each), and the placement trail is this history narrowed
to placements. What is state stays where it is - an application's verdict, the market's
``phaseHistory`` - and its changes are recorded here as well. The deletion trail (``deletion_trail.py``) stays apart, because it
must outlive what it describes and this history is deleted with its market.

**An entry says what happened, never a sentence**: the ``E39`` action it was
(``api.market_actions``, so the verb that asked "may this person" is the one recorded), a finer
kind where one action covers several changes, the vendors it is about, whatever else it is about,
and a structured detail. The wording belongs to whichever surface shows it
(``front-end/src/utils/placementHistory.ts`` for the placements) and must be changeable without a
migration - the same rule ``placement_reasons`` follows.

**A run is one entry**, not none and not one per placement. Omitting runs would leave the history
lying by omission, because a placement that changed between two hand edits would have no
explanation. One entry per placement would drown the hand edits under machine rows, and the hand
edits are the entries anyone actually reads.

**Deliberate, not incidental:** recording *who* attaches an organizer's identity to a market that
may be exported, shared, or handed to a successor organizer. That was weighed and accepted for the
placements (readable-journey ticket 08) and widened to every change on Daniel's word (Q23).

Storage contract: documents are persisted snake_case with the market foreign key ``market_id``,
matching ``applications`` rather than ``markets`` - and, like applications, every reader and
writer goes through this module. A market's history is deleted with the market.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Union

from api.market_actions import ASSIGN, CHANGE_THE_TABLE, Action
from db_config import get_database
from utils.email_address import normalized_email

logger = logging.getLogger(__name__)

HISTORY_COLLECTION = "history"
MARKET_ID_FIELD = "market_id"
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
FLOORPLAN = "floorplan"
FLOORPLAN_IMAGE_DELETED = "floorplan_image_deleted"
FORM = "form"
REVIEW_HIGHLIGHTS = "review_highlights"
REJECTION_RULES = "rejection_rules"
RESUMED = "resumed"
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
    _write(market_id, actor, action.id, kind, vendors, subject, detail)


def record_applicant(
    market_id: str, applicant: str, kind: str, application_id: str, detail: Part,
) -> None:
    """An applicant's own change to their application, with the applicant as its actor.

    No row of the table asks it - the applicant holds no role, and their sign-in is the check - so
    its action is the history's own ``apply``.
    """
    _write(market_id, applicant, APPLY, kind, [applicant], {"application_id": application_id},
           detail)


def _built(part: Part) -> Optional[Dict[str, Any]]:
    return part() if callable(part) else part


def _write(
    market_id: str, actor: Optional[str], action_id: str, kind: Optional[str],
    vendors: Iterable[str], subject: Part, detail: Part,
) -> None:
    try:
        built = _built(detail)
        if built is None:
            return
        history_collection.insert_one({
            "id": str(uuid.uuid4()),
            MARKET_ID_FIELD: market_id,
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
        logger.warning("Could not record %s on market %s: %s", kind or action_id, market_id,
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


# --- The table: a market owner's changes to who may do what (E39/F01/S03) -------------------

_PERMISSION_FIELDS = ("id", MARKET_ID_FIELD, "actor", "at", "action", "kind", "subject", "detail")


def permission_entries(market_id: str) -> List[Dict[str, Any]]:
    """This market's history narrowed to the changes to its table, newest first."""
    query = {MARKET_ID_FIELD: market_id, "action": CHANGE_THE_TABLE.id}
    projection = {"_id": 0, **{field: 1 for field in _PERMISSION_FIELDS}}
    return _newest_first(history_collection.find(query, projection))
