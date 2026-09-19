"""Single owner of the ``placement_history`` collection: who changed a placement, to what, when.

A placement that differs from what the solver produced is a fact someone will later ask about,
and a flag saying "hand-placed" cannot answer it. There is no audit or history anywhere else in
this codebase, so the scope is bounded deliberately: **placements only**. Phase transitions, plan
edits and form edits are out, and review verdicts already have their own record in the
application's status. A narrow trail that gets read beats a general one that gets ignored.

**A solver run is one entry**, not none and not one per placement. Omitting runs would leave the
trail lying by omission, because a placement that changed between two hand edits would have no
explanation. One entry per placement would drown the hand edits under machine rows, and the hand
edits are the entries anyone actually reads.

Entries are stored structured, never as a sentence: the wording belongs to whichever surface is
showing it (``front-end/src/utils/placementHistory.ts``), and must be changeable without a
migration - the same rule ``placement_reasons`` follows.

**Deliberate, not incidental:** recording *who* attaches an organizer's identity to a market that
may be exported, shared, or handed to a successor organizer. That privacy surface was weighed and
accepted when this was decided (readable-journey ticket 08); do not widen it without revisiting
that.

Storage contract: documents are persisted snake_case with the market foreign key ``market_id``,
matching ``applications`` rather than ``markets`` - and, like applications, every reader and
writer goes through this module. A market's history is deleted with the market.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db_config import get_database

logger = logging.getLogger(__name__)

PLACEMENT_HISTORY_COLLECTION = "placement_history"
MARKET_ID_FIELD = "market_id"

db = get_database()
placement_history_collection = db[PLACEMENT_HISTORY_COLLECTION]

# What happened. An enum of kinds rather than a message, so a surface can word it, group it or
# filter by it without parsing prose.
PLACED = "placed"
FREED = "freed"
SWAPPED = "swapped"
ASSIGNED = "assigned"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _record(
    market_id: str, actor: str, kind: str, vendors: List[str], detail: Dict[str, Any]
) -> None:
    """Write one entry. Never raises: a trail that can break a placement is worse than no trail.

    The write that matters has already happened by the time this is called - the seat is taken,
    and check-in will read it. Failing the request because the *record* of it could not be saved
    would tell the organizer their change did not land when it did.
    """
    try:
        placement_history_collection.insert_one({
            "id": str(uuid.uuid4()),
            MARKET_ID_FIELD: market_id,
            "actor": actor,
            "at": _now(),
            "kind": kind,
            # Lowercased, because an address is a person and case is not part of who they are:
            # a vendor's own panel looks its entries up by this list.
            "vendors": [email.strip().lower() for email in vendors if email],
            "detail": detail,
        })
    except Exception as e:  # pragma: no cover - defensive
        logger.warning("Could not record %s on market %s: %s", kind, market_id, e)


def record_placed(market_id: str, actor: str, placement) -> None:
    """One vendor put in one seat by hand."""
    _record(market_id, actor, PLACED, [placement.email], {
        "date": placement.date,
        "table_code": placement.table_code,
        "table_choice": placement.table_choice,
    })


def record_freed(market_id: str, actor: str, email: str, date: str, table_code: str) -> None:
    """One seat emptied. Recorded even though nobody was placed: it is what a vendor dropping out
    looks like, and the question "where did they go" is asked about exactly this."""
    _record(market_id, actor, FREED, [email], {"date": date, "table_code": table_code})


def record_swapped(market_id: str, actor: str, date: str, first, second) -> None:
    """Two vendors traded seats - ONE entry, because it was one action."""
    _record(market_id, actor, SWAPPED, [first.email, second.email], {
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
    _record(market_id, actor, ASSIGNED, [], {
        "placements_written": placements_written,
        "pins_preserved": pins_preserved,
    })


def entries_for_market(market_id: str, vendor: Optional[str] = None) -> List[Dict[str, Any]]:
    """This market's trail, newest first.

    ``vendor`` narrows it to the entries about one person, for their detail panel. A solver run
    names nobody, so it is not in a vendor's list: it says what happened to the market, and the
    question a vendor's panel is asking is what happened to *them*.
    """
    query: Dict[str, Any] = {MARKET_ID_FIELD: market_id}
    if vendor:
        query["vendors"] = vendor.strip().lower()

    entries = list(placement_history_collection.find(query, {"_id": 0}))
    entries.sort(key=lambda entry: entry.get("at") or "", reverse=True)
    return entries


def delete_for_market(market_id: str) -> int:
    """Take a market's history with the market. Returns how many entries went."""
    result = placement_history_collection.delete_many({MARKET_ID_FIELD: market_id})
    return result.deleted_count
