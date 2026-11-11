"""Who came to a market on each of its days: the check-ins, the roster the organizer works from, the
Stats tab's count of it, and whether a market ran.

A check-in is made by an organizer at Attendance (``api/door.py``) or by the vendor on their vendor
page with the door code (``api/vendor_check_in.py``); both write through ``record_attendance``, and
the record says which (``checked_in_by``, ``checked_in_via``).
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from pymongo.errors import DuplicateKeyError

import api.applications as ApplicationsApi
import api.market_actions as Actions
import history as History
import phase_record as PhaseRecord
from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from datatypes import MarketPhase, phase_from_market_document, table_code_sort_key
from db_config import get_database
from market_documents import market_dates_of
from unique_indexes import ensure_vendor_day_index
from utils.email_address import normalized_email

ATTENDANCE_COLLECTION = "attendance"

db = get_database()
attendance_collection = db[ATTENDANCE_COLLECTION]
markets_collection = db["markets"]

ENDED_REFUSAL = "This market has ended, so check-in is closed."

#: The ``via`` of a vendor's own check-in, made with the door code on their vendor page (ADR 0022).
VIA_DOOR_CODE = "door_code"
#: The ``via`` of a vendor's own undo, on their vendor page, which takes no door code.
VIA_VENDOR_PAGE = "vendor_page"


def ensure_attendance_indexes() -> None:
    """One attendance record per vendor's day, held by the database (T270).

    A check-in is an upsert by market, vendor and date, and two that land at once both match
    nothing and both insert, so only a unique index keeps the day one record: with two, one Undo
    left the vendor reading as here, and the history held two arrivals. ``app.py`` builds it at
    boot and refuses to start without it (``unique_indexes``).
    """
    ensure_vendor_day_index(attendance_collection, ATTENDANCE_COLLECTION)


def _stored_assignment_rows(market_doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The market's stored placements, snake_cased: the one thing check-in reads, both to tell a
    vendor where to go and to record that they came."""
    market_snake = convert_keys_to_snake_case(market_doc.copy())
    assignment_object = market_snake.get("assignment_object") or {}
    return list(assignment_object.get("vendor_assignments") or [])


def seated_on(market_doc: Dict[str, Any], vendor_email: str, date: str) -> bool:
    """Does the market's stored assignment seat this vendor on this date?

    A placement is dated by the market date itself. It used to be dated by the spreadsheet column
    heading that asked about that day, so every reader here had to build a map from headings back
    to dates before it could compare anything.
    """
    target_email = normalized_email(vendor_email)
    return any(
        normalized_email(str(row.get("email", ""))) == target_email
        and str(row.get("date", "")) == date
        for row in _stored_assignment_rows(market_doc)
    )


def market_has_ended(market_doc: Dict[str, Any]) -> bool:
    """Is this market a record rather than a door? Nobody checks in at an archived market."""
    return phase_from_market_document(market_doc) is MarketPhase.ARCHIVED


def market_ran(market_doc: Dict[str, Any]) -> bool:
    """Did this market reach its market days? Read off its phase record, and where that is partial,
    off whether anyone checked in (``phase_record``)."""
    return PhaseRecord.phases_reached(market_doc, market_has_attendance).ran


def ended_after_it_ran(market_doc: Dict[str, Any]) -> bool:
    """Is this market a record of days that happened: archived, after it ran?"""
    return market_has_ended(market_doc) and market_ran(market_doc)


def check_ins_of(market_id: str, vendor_email: str) -> Dict[str, Optional[str]]:
    """When one vendor checked in at a market, ``{date: checked_in_at}``, for the dates they did."""
    return {
        doc["date"]: doc.get("checked_in_at")
        for doc in attendance_collection.find({
            "market_id": market_id,
            "vendor_email": normalized_email(vendor_email),
        })
        if doc.get("date")
    }


def undo_attendance(
    market_id: str, vendor_email: str, date: str, undone_by: Optional[str] = None,
    via: Optional[str] = None,
) -> Tuple[Dict[str, Any], int]:
    """Remove a check-in a vendor made on the wrong day.

    A two-day market offered an identical button per date and no undo, so one mis-tap recorded a
    vendor as present on a day they were not. Deleting the record is the whole operation: a
    check-in is a single document keyed by (market, vendor, date), and there is nothing else it
    changed.
    """
    if not isinstance(market_id, str) or not market_id.strip():
        return {"error": "market_id is required"}, 400
    if not isinstance(vendor_email, str) or not vendor_email.strip():
        return {"error": "vendorEmail is required"}, 400
    if not isinstance(date, str) or not date.strip():
        return {"error": "date is required"}, 400

    result = attendance_collection.delete_one({
        "market_id": market_id,
        "vendor_email": normalized_email(vendor_email),
        "date": date.strip(),
    })
    if result.deleted_count == 0:
        return {"error": "No check-in found for this vendor on this date"}, 404
    _record_door(market_id, vendor_email, date, undone_by, via, History.CHECK_IN_UNDONE, False)
    return {"message": "Check-in undone"}, 200


def record_attendance(
    market_id: str, vendor_email: str, date: str, checked_in_by: Optional[str] = None,
    via: Optional[str] = None,
) -> Tuple[Dict[str, Any], int]:
    """Upsert an attendance record for (market_id, vendor_email, date).

    ``checked_in_by`` is the organizer who checked the vendor in at the door (E29/F01/S02), and
    None when the vendor did it themselves, when ``via`` says how (``VIA_DOOR_CODE``). Both are
    written either way, so a vendor checking in again after an organizer did is not still credited
    to the organizer, nor an organizer's check-in after a scan to the door code.

    Two check-ins of one vendor's day at once leave one record and one "checked in" entry: the
    unique index refuses the second insert (``ensure_attendance_indexes``), the loser lands on the
    winner's record, and only the call that inserted the record writes the entry.
    """
    if not isinstance(market_id, str) or not market_id.strip():
        return {"error": "market_id is required"}, 400
    if not isinstance(vendor_email, str) or not vendor_email.strip():
        return {"error": "vendorEmail is required"}, 400
    if not isinstance(date, str) or not date.strip():
        return {"error": "date is required"}, 400

    market_doc = markets_collection.find_one({"id": market_id})
    if not market_doc:
        return {"error": "Market not found"}, 404

    target_email = normalized_email(vendor_email)
    target_date = date.strip()
    if not seated_on(market_doc, target_email, target_date):
        return {"error": "No assignment found for this vendor on this date"}, 404

    checked_in_at = datetime.now(timezone.utc).isoformat()
    vendor_day = {"market_id": market_id, "vendor_email": target_email, "date": target_date}
    check_in = {"$set": {
        **vendor_day,
        "checked_in_at": checked_in_at,
        "checked_in_by": checked_in_by,
        "checked_in_via": via,
    }}
    try:
        written = attendance_collection.update_one(vendor_day, check_in, upsert=True)
    except DuplicateKeyError:
        # Another check-in of this vendor's day inserted between this upsert's match and its
        # insert, and the unique index refused the second record. Run once more, which lands on
        # the winner's record; a second refusal is not this race, and goes on as the error it is.
        written = attendance_collection.update_one(vendor_day, check_in, upsert=True)

    # Only a vendor not yet here is a change: checking in again is a new time, not a new arrival.
    if written.upserted_id is not None:
        _record_door(
            market_id, vendor_email, target_date, checked_in_by, via, History.CHECKED_IN, True)
    return {"message": "Checked in", "checkedInAt": checked_in_at}, 200


def _record_door(
    market_id: str, vendor_email: str, date: str, by: Optional[str], via: Optional[str],
    kind: str, here: bool,
) -> None:
    """A check-in or its undo, by the organizer who made it; or the vendor's own, on their vendor
    page, with no actor beside the vendor it names and ``via`` saying how (``VIA_DOOR_CODE``,
    ``VIA_VENDOR_PAGE``).

    An entry written before the vendor page carries ``via: "check_in_page"``: the public check-in
    page it names asked only an address and a date, and proved no one. The history's readers still
    word it.
    """
    vendor = normalized_email(vendor_email)
    History.record(
        market_id, by, Actions.CHECK_IN, kind=kind, vendors=[vendor],
        subject={"date": date.strip()},
        detail=lambda: {**History.changes({"checked_in": not here}, {"checked_in": here}),
                        **({"via": via} if via else {})},
    )


def attendance_roster(market_doc: Dict[str, Any]) -> Dict[str, Any]:
    """Every vendor the stored assignment places, per market date, and whether they have come.

    What the organizer at the door works from (E29/F01/S01). Attendance listed only the vendors who
    had checked in, by email, so with 80 vendors a day nobody could say who was missing (known gap
    3). Read off the same stored rows check-in records against, so the list of who is expected
    where can never disagree with where a vendor is sent.
    """
    market_id = market_doc.get("id")
    names = ApplicationsApi.vendor_names_for_market(market_id)
    check_ins = {
        (doc.get("vendor_email"), doc.get("date")): doc
        for doc in attendance_collection.find({"market_id": market_id})
    }
    roster = []
    for row in _stored_assignment_rows(market_doc):
        email = normalized_email(str(row.get("email", "")))
        date = str(row.get("date", ""))
        check_in = check_ins.get((email, date)) or {}
        roster.append({
            "date": date,
            "vendor_email": email,
            "vendor_name": names.get(email, ""),
            "table_code": row.get("table_code"),
            "table_choice": row.get("table_choice"),
            "section": row.get("section"),
            "location": row.get("location"),
            "checked_in_at": check_in.get("checked_in_at"),
            "checked_in_by": check_in.get("checked_in_by"),
            "checked_in_via": check_in.get("checked_in_via"),
        })
    roster.sort(key=lambda r: (
        r["date"], table_code_sort_key(r["table_code"] or ""), str(r["table_choice"] or ""),
    ))

    return convert_keys_to_camel_case({"dates": market_dates_of(market_doc), "roster": roster})


def check_in_counts(market_doc: Dict[str, Any]) -> Dict[str, Any]:
    """How the door stands, in figures only, for the Stats tab's Check-in (T201): per market date,
    the vendors expected and those checked in, and ``came``, the vendors checked in on any date.

    Read as ``attendance_roster`` reads it, off the same stored rows and attendance records, so
    each date's figures are the door's own count of that day (a row each, here or not); but it
    reads no names and holds no row, as the page it serves names nobody.
    """
    here = {
        (doc.get("vendor_email"), doc.get("date"))
        for doc in attendance_collection.find(
            {"market_id": market_doc.get("id")}, {"vendor_email": 1, "date": 1})
    }
    expected: Dict[str, int] = {}
    checked_in: Dict[str, int] = {}
    came = set()
    for row in _stored_assignment_rows(market_doc):
        email = normalized_email(str(row.get("email", "")))
        date = str(row.get("date", ""))
        expected[date] = expected.get(date, 0) + 1
        if (email, date) in here:
            checked_in[date] = checked_in.get(date, 0) + 1
            came.add(email)
    return {
        "dates": [
            {"date": date, "expected": expected.get(date, 0),
             "checkedIn": checked_in.get(date, 0)}
            for date in market_dates_of(market_doc)
        ],
        "came": len(came),
    }


def get_attendance_for_market(market_id: str) -> Tuple[List[Dict[str, Any]], int]:
    """Return all attendance documents for a market in camelCase."""
    records: List[Dict[str, Any]] = []
    for doc in attendance_collection.find({"market_id": market_id}):
        records.append(convert_keys_to_camel_case({
            "market_id": doc.get("market_id"),
            "vendor_email": doc.get("vendor_email"),
            "date": doc.get("date"),
            "checked_in_at": doc.get("checked_in_at"),
        }))
    return records, 200


def market_has_attendance(market_id: str) -> bool:
    """Has anyone checked in at this market? The one proof a market ran (``phase_record``)."""
    return attendance_collection.find_one({"market_id": market_id}) is not None


def delete_attendance_for_market(market_id: str) -> int:
    """Take a market's check-ins with the market (``market_deletion``). Returns how many went."""
    return attendance_collection.delete_many({"market_id": market_id}).deleted_count
