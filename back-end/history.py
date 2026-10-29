"""Single owner of the ``history`` collection: every change on a market, who made it, and when.

**One history for every change** (E40, ADR 0017). It began as the placement history, which kept
placements only; Daniel widened it ("every change is logged", Q23), so every write that changes a
market, its applications or its vendors is to record here (the placement writes do; E40/F01/S02
brings the rest), and the placement trail is this history narrowed to placements. What is state
stays where it is - an application's verdict, the market's ``phaseHistory`` - and its changes are
to be recorded here as well. The deletion trail (``deletion_trail.py``) stays apart, because it
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
from typing import Any, Dict, Iterable, List, Optional

from api.market_actions import ASSIGN, Action
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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def record(
    market_id: str, actor: str, action: Action, *, kind: Optional[str] = None,
    vendors: Iterable[str] = (), subject: Optional[Dict[str, Any]] = None,
    detail: Optional[Dict[str, Any]] = None,
) -> None:
    """Write one entry. Never raises: a history that can break a change is worse than no history.

    The write that matters has already happened by the time this is called - the seat is taken,
    and check-in will read it. Failing the request because the *record* of it could not be saved
    would tell the organizer their change did not land when it did.
    """
    try:
        history_collection.insert_one({
            "id": str(uuid.uuid4()),
            MARKET_ID_FIELD: market_id,
            "actor": actor,
            "at": _now(),
            "action": action.id,
            "kind": kind,
            # Lowercased, because an address is a person and case is not part of who they are:
            # a vendor's own panel looks its entries up by this list.
            "vendors": [normalized_email(email) for email in vendors if email],
            "subject": subject or {},
            "detail": detail or {},
        })
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Could not record %s on market %s: %s", kind or action.id, market_id, e)


def entries_for_market(market_id: str, vendor: Optional[str] = None) -> List[Dict[str, Any]]:
    """This market's history, newest first.

    ``vendor`` narrows it to the entries about one person, for their detail panel. A run names
    nobody, so it is not in a vendor's list: it says what happened to the market, and the question
    a vendor's panel is asking is what happened to *them*.
    """
    query = _vendor_query({MARKET_ID_FIELD: market_id}, vendor)
    return _newest_first(history_collection.find(query, {"_id": 0}))


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
        subject=placement_subject(kind, detail), detail=detail,
    )


def record_placed(market_id: str, actor: str, placement) -> None:
    """One vendor put in one seat by hand."""
    _record_placement(market_id, actor, PLACED, [placement.email], {
        "date": placement.date,
        "table_code": placement.table_code,
        "table_choice": placement.table_choice,
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
