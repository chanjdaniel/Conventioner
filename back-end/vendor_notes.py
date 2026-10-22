"""Single owner of the ``vendor_notes`` collection: what the organizer knows and did about a vendor.

E31/F04, decided in ``wayfinding/what-to-show-and-when/03`` and kept in
``docs/implementation/modules/vendor-notes.md``. A vendor may
need something beyond their table - an extra chair, an outlet - and two kinds of note answer it,
kept apart rather than one field with two authors:

- **The vendor's request** is their own answer on the application (``essential_request``), which
  they see and the organizer reads. It is not kept here.
- **The organizer's side** is kept here, one document per vendor per market: the organizer's note
  (one shared text, who last edited it and when), a ``from_sheet`` line an import replaces from a
  column of the organizer's own spreadsheet and that never touches the note, and the mark that the
  vendor's request has been handled, so the door can tell "needs a chair" from "already got one".

**The vendor never sees any of it.** That is why it is a collection of its own rather than fields on
the application, which applicant endpoints return: a separate collection that no applicant endpoint
reads cannot leak by a field someone forgot to strip.

Storage contract: snake_case with the market foreign key ``market_id`` and the vendor's address
lowercased, like ``applications`` and ``attendance``; every reader and writer goes through this
module, and a market's notes are deleted with the market (``market_deletion``).
"""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from db_config import get_database
from utils.email_address import normalized_email

VENDOR_NOTES_COLLECTION = "vendor_notes"
MARKET_ID_FIELD = "market_id"
VENDOR_EMAIL_FIELD = "vendor_email"

db = get_database()
vendor_notes_collection = db[VENDOR_NOTES_COLLECTION]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _key(market_id: str, vendor_email: str) -> Dict[str, str]:
    return {MARKET_ID_FIELD: market_id, VENDOR_EMAIL_FIELD: normalized_email(vendor_email)}


def _set(market_id: str, vendor_email: str, fields: Dict[str, Any]) -> None:
    vendor_notes_collection.find_one_and_update(
        _key(market_id, vendor_email), {"$set": fields}, upsert=True,
    )


def write_note(market_id: str, vendor_email: str, text: str, by: str) -> None:
    """Replace the organizer's note on one vendor. Blank is no note."""
    _set(market_id, vendor_email, {
        "note": str(text or "").strip(), "note_edited_by": by, "note_edited_at": _now(),
    })


def mark_request_handled(market_id: str, vendor_email: str, handled: bool, by: str) -> None:
    """Mark the vendor's request handled, or take the mark back."""
    _set(market_id, vendor_email, {
        "request_handled_at": _now() if handled else None,
        "request_handled_by": by if handled else None,
    })


def replace_sheet_notes(market_id: str, by_vendor: Dict[str, str]) -> None:
    """Each import's "From your sheet" lines replace the last import's, and touch nothing else.

    A vendor the file no longer has a line for loses theirs, because the line is the sheet's and
    the sheet no longer says it.
    """
    wanted = {
        normalized_email(email): str(text or "").strip() for email, text in by_vendor.items()
    }
    for doc in vendor_notes_collection.find({MARKET_ID_FIELD: market_id}):
        email = doc.get(VENDOR_EMAIL_FIELD)
        if email not in wanted and doc.get("from_sheet"):
            vendor_notes_collection.update_one(
                _key(market_id, email), {"$set": {"from_sheet": None}}
            )
    for email, text in wanted.items():
        _set(market_id, email, {"from_sheet": text or None})


def _entry(doc: Dict[str, Any]) -> Dict[str, Optional[str]]:
    return {
        "note": doc.get("note") or "",
        "noteEditedBy": doc.get("note_edited_by"),
        "noteEditedAt": doc.get("note_edited_at"),
        "fromSheet": doc.get("from_sheet"),
        "requestHandledAt": doc.get("request_handled_at"),
        "requestHandledBy": doc.get("request_handled_by"),
    }


def notes_for_market(market_id: str) -> Dict[str, Dict[str, Optional[str]]]:
    """Every vendor's notes on one market, by lowercased address, camelCased for the wire."""
    return {
        doc[VENDOR_EMAIL_FIELD]: _entry(doc)
        for doc in vendor_notes_collection.find({MARKET_ID_FIELD: market_id})
    }


def no_notes() -> Dict[str, Optional[str]]:
    """The entry of a vendor nobody has written about yet."""
    return _entry({})


def delete_for_market(market_id: str) -> int:
    """Take a market's notes with the market. Returns how many went."""
    return vendor_notes_collection.delete_many({MARKET_ID_FIELD: market_id}).deleted_count
