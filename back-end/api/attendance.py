from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import api.applications as ApplicationsApi
import phase_record as PhaseRecord
from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from datatypes import MarketPhase, phase_from_market_document
from db_config import get_database
from market_documents import CHECK_IN_RECORD_PHASES, market_by_slug, published_market_by_slug

db = get_database()
attendance_collection = db["attendance"]
markets_collection = db["markets"]

ENDED_REFUSAL = "This market has ended, so check-in is closed."


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _stored_assignment_rows(market_doc: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The market's stored placements, snake_cased: the one thing check-in reads, both to tell a
    vendor where to go and to record that they came."""
    market_snake = convert_keys_to_snake_case(market_doc.copy())
    assignment_object = market_snake.get("assignment_object") or {}
    return list(assignment_object.get("vendor_assignments") or [])


def get_published_market_by_slug(market_slug: str) -> Optional[Dict[str, Any]]:
    """The running market at this slug: the one a vendor can check in at."""
    return published_market_by_slug(markets_collection, market_slug)


def get_check_in_market(market_slug: str) -> Optional[Dict[str, Any]]:
    """The market a check-in page serves: one running now, or one archived after it ran (bug 9).

    An archived market is the record of what happened, and its check-in page is part of that
    record: a vendor can still look up where they sat and when they checked in. Archiving used to
    take the page off the air, against the docs and the organization-deletion preview, which both
    said an archived market is still served. One archived without ever running had no check-in
    page, and still has none - which only the phase record can tell apart.
    """
    market_doc = market_by_slug(markets_collection, market_slug, CHECK_IN_RECORD_PHASES)
    if market_doc is None:
        return None
    if market_has_ended(market_doc) and not PhaseRecord.phases_reached(
        market_doc, market_has_attendance,
    ).ran:
        return None
    return market_doc


def market_has_ended(market_doc: Dict[str, Any]) -> bool:
    """Is this check-in page a record rather than a door? Nobody checks in at an archived market."""
    return phase_from_market_document(market_doc) is MarketPhase.ARCHIVED


def get_checkin_page(market_slug: str) -> Tuple[Dict[str, Any], int]:
    """What the check-in page can say before the vendor types anything: which market this is.

    The page used to read "Vendor Check-in" until after a lookup, so a vendor handed a URL or a QR
    code at a door had to enter their address to find out whether they were at the right market's
    page - the confirmation arriving after the work rather than before it.

    Open to every market check-in serves, like the rest of check-in and unlike the applicant-intake
    surface: how a vendor entered a market has no bearing on whether they can scan in on the day.
    It answers only for a market reachable at this slug, which is the same fact an accepted lookup
    already reveals - and says whether it has ended, so the page offers a record rather than a door.
    """
    if not isinstance(market_slug, str) or not market_slug.strip():
        return {"error": "market slug is required"}, 400

    market_doc = get_check_in_market(market_slug)
    if not market_doc:
        return {"error": "Market not found"}, 404

    setup = market_doc.get("setupObject") or {}
    dates = [
        str(entry.get("date"))
        for entry in (setup.get("marketDates") or [])
        if isinstance(entry, dict) and entry.get("date")
    ]
    return {
        "marketName": market_doc.get("name", ""),
        "marketSlug": market_slug,
        "marketDates": sorted(dates),
        "ended": market_has_ended(market_doc),
    }, 200


def undo_attendance(market_id: str, vendor_email: str, date: str) -> Tuple[Dict[str, Any], int]:
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
        "vendor_email": _normalize_email(vendor_email),
        "date": date.strip(),
    })
    if result.deleted_count == 0:
        return {"error": "No check-in found for this vendor on this date"}, 404
    return {"message": "Check-in undone"}, 200


def record_attendance(market_id: str, vendor_email: str, date: str) -> Tuple[Dict[str, Any], int]:
    """Upsert an attendance record for (market_id, vendor_email, date)."""
    if not isinstance(market_id, str) or not market_id.strip():
        return {"error": "market_id is required"}, 400
    if not isinstance(vendor_email, str) or not vendor_email.strip():
        return {"error": "vendorEmail is required"}, 400
    if not isinstance(date, str) or not date.strip():
        return {"error": "date is required"}, 400

    market_doc = markets_collection.find_one({"id": market_id})
    if not market_doc:
        return {"error": "Market not found"}, 404

    vendor_assignments = _stored_assignment_rows(market_doc)

    target_email = _normalize_email(vendor_email)
    target_date = date.strip()

    # A placement is dated by the market date itself. It used to be dated by the spreadsheet
    # column heading that asked about that day, so every reader here had to build a map from
    # headings back to dates before it could compare anything.
    has_match = False
    for assignment in vendor_assignments:
        a_email = _normalize_email(str(assignment.get("email", "")))
        a_date = str(assignment.get("date", ""))
        if a_email == target_email and a_date == target_date:
            has_match = True
            break

    if not has_match:
        return {"error": "No assignment found for this vendor on this date"}, 404

    checked_in_at = datetime.now(timezone.utc).isoformat()
    attendance_collection.update_one(
        {
            "market_id": market_id,
            "vendor_email": target_email,
            "date": target_date,
        },
        {
            "$set": {
                "market_id": market_id,
                "vendor_email": target_email,
                "date": target_date,
                "checked_in_at": checked_in_at,
            }
        },
        upsert=True,
    )

    return {"message": "Checked in", "checkedInAt": checked_in_at}, 200


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


def get_vendor_assignment_summary(market_slug: str, vendor_email: str) -> Tuple[Dict[str, Any], int]:
    """A vendor's seats at a market check-in serves, with when they checked in to each.

    Served for an ended market too, marked so: there it is the record of where they sat."""
    if not isinstance(market_slug, str) or not market_slug.strip():
        return {"error": "market slug is required"}, 400
    if not isinstance(vendor_email, str) or not vendor_email.strip():
        return {"error": "vendorEmail is required"}, 400

    target_email = _normalize_email(vendor_email)

    market_doc = get_check_in_market(market_slug)
    if not market_doc:
        return {"error": "Market not found"}, 404

    market_id = market_doc.get("id")

    # The stored assignment, exactly as check-in will record against it: every swap, hand
    # placement and freed seat the organizer made. This ran the solver afresh on every lookup,
    # ignoring all of them, so a vendor moved by hand was sent to their old seat - by then another
    # vendor's - and could check in there (bug 1). It also ran the solver for anyone on the web.
    matched: List[Dict[str, Any]] = [
        {
            "date": str(row.get("date", "")),
            "table_code": row.get("table_code"),
            "table_choice": row.get("table_choice"),
            "section": row.get("section"),
            "tier": row.get("tier"),
            "location": row.get("location"),
        }
        for row in _stored_assignment_rows(market_doc)
        if _normalize_email(str(row.get("email", ""))) == target_email
    ]

    if not matched:
        return {"error": "No assignment found for this email"}, 404

    attendance_docs = list(attendance_collection.find({
        "market_id": market_id,
        "vendor_email": target_email,
    }))
    by_date: Dict[str, str] = {}
    for doc in attendance_docs:
        d = doc.get("date")
        if d:
            by_date[d] = doc.get("checked_in_at")

    for row in matched:
        row["checked_in_at"] = by_date.get(row["date"])

    matched.sort(key=lambda r: r["date"])

    # The vendor's own name, so the page they look themselves up on greets them rather than
    # their address. Absent for an application written before names existed, and the page falls
    # back to the address exactly as it did then.
    names = ApplicationsApi.vendor_names_for_market(market_id)

    payload = {
        "market_name": market_doc.get("name", ""),
        "market_slug": market_slug,
        "vendor_email": target_email,
        "vendor_name": names.get(target_email, ""),
        "assignments": matched,
        "ended": market_has_ended(market_doc),
    }
    return convert_keys_to_camel_case(payload), 200


def market_has_attendance(market_id: str) -> bool:
    """Has anyone checked in at this market? The one proof a market ran (``phase_record``)."""
    return attendance_collection.find_one({"market_id": market_id}) is not None


def delete_attendance_for_market(market_id: str) -> int:
    """Take a market's check-ins with the market (``market_deletion``). Returns how many went."""
    return attendance_collection.delete_many({"market_id": market_id}).deleted_count
