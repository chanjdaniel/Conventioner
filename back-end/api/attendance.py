from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from assignment.assignment import assign_market
from assignment.utils import convert_keys_to_camel_case, convert_keys_to_snake_case
from datatypes import MarketPhase, phase_from_market_document
from db_config import get_database
from market_documents import market_from_document, non_draft_market_prefilter
import api.source_data as SourceDataApi

db = get_database()
attendance_collection = db["attendance"]
markets_collection = db["markets"]


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _slugify(name: str) -> str:
    """Mirror the front-end marketNameToKebabSlug rule."""
    if not name:
        return ""
    import re
    import unicodedata
    s = unicodedata.normalize("NFKD", name.strip())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def get_published_market_by_slug(market_slug: str) -> Optional[Dict[str, Any]]:
    """Find a published (phase != draft) market whose slugified name equals slug.

    A Mongo condition cannot decide this: ``{"phase": {"$ne": "draft"}}`` also matches a
    document that carries no ``phase`` at all, which is exactly what a draft written before the
    field existed looks like - it would put an unpublished market on a public check-in URL.
    ``phase_from_market_document`` is the one place that knows a document's effective phase, so
    the draft test goes through it in Python. ``non_draft_market_prefilter`` only prunes the
    documents that are unambiguously drafts, keeping this off a full-collection decode on an
    unauthenticated endpoint without letting a Mongo condition decide what counts as published.
    """
    if not market_slug:
        return None
    target = market_slug.strip().lower()
    for doc in markets_collection.find(non_draft_market_prefilter()):
        if _slugify(doc.get("name", "")) != target:
            continue
        if phase_from_market_document(doc) == MarketPhase.DRAFT:
            continue
        return doc
    return None


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

    market_snake = convert_keys_to_snake_case(market_doc.copy())
    assignment_object = market_snake.get("assignment_object") or {}
    vendor_assignments = assignment_object.get("vendor_assignments") or []

    target_email = _normalize_email(vendor_email)
    target_date = date.strip()

    setup_object = market_snake.get("setup_object") or {}
    date_aliases: Dict[str, str] = {}
    for md in setup_object.get("market_dates") or []:
        d = md.get("date")
        if d:
            date_aliases[d] = d
            cn = md.get("col_name")
            if cn:
                date_aliases[cn] = d

    has_match = False
    for assignment in vendor_assignments:
        a_email = _normalize_email(str(assignment.get("email", "")))
        a_date_raw = str(assignment.get("date", ""))
        a_date = date_aliases.get(a_date_raw, a_date_raw)
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
    """Return a single vendor's assignments for a published market, with check-in status."""
    if not isinstance(market_slug, str) or not market_slug.strip():
        return {"error": "market slug is required"}, 400
    if not isinstance(vendor_email, str) or not vendor_email.strip():
        return {"error": "vendorEmail is required"}, 400

    target_email = _normalize_email(vendor_email)

    market_doc = get_published_market_by_slug(market_slug)
    if not market_doc:
        return {"error": "Market not found"}, 404

    market_id = market_doc.get("id")
    market_snake = convert_keys_to_snake_case(market_doc.copy())

    if "setup_object" in market_snake and market_snake["setup_object"]:
        if "assignment_options" not in market_snake["setup_object"]:
            market_snake["setup_object"]["assignment_options"] = {
                "max_assignments_per_vendor": None,
                "max_half_table_proportion_per_section": None,
                "email_col_name_idx": None,
                "table_choice_col_name_idx": None,
                "table_share_email_col_name_idx": None,
                "max_days_col_name_idx": None,
            }
    market_snake["assignment_object"] = {
        "vendor_assignments": [],
        "assignment_date": "",
        "assignment_statistics": None,
    }

    try:
        market = market_from_document(market_doc, market_snake)
    except Exception:
        return {"error": "Invalid market data"}, 400

    source_data = None
    try:
        source_result = SourceDataApi.get_source_data(market_id)
        if source_result is not None:
            source_data, _ = source_result
    except Exception:
        source_data = None

    try:
        assigned_market = assign_market(market, source_data)
    except Exception:
        return {"error": "Unable to derive assignments"}, 500

    setup = assigned_market.setup_object
    date_aliases: Dict[str, str] = {}
    if setup is not None:
        for md in setup.market_dates:
            date_aliases[md.date] = md.date
            if md.col_name:
                date_aliases[md.col_name] = md.date

    matched: List[Dict[str, Any]] = []
    for assignment in assigned_market.assignment_object.vendor_assignments:
        if _normalize_email(assignment.email) != target_email:
            continue
        canonical_date = date_aliases.get(assignment.date, assignment.date)
        matched.append({
            "date": canonical_date,
            "table_code": assignment.table_code,
            "table_choice": assignment.table_choice,
            "section": assignment.section,
            "tier": assignment.tier,
            "location": assignment.location,
        })

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

    payload = {
        "market_name": market_doc.get("name", ""),
        "market_slug": market_slug,
        "vendor_email": target_email,
        "assignments": matched,
    }
    return convert_keys_to_camel_case(payload), 200
