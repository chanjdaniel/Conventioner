"""An organizer checks a vendor in at the door, or undoes it (E29/F01/S02), and makes the
market's door code, the vendor's proof that they are at the door (ADR 0022).

The vendor's own check-in is on their vendor page, behind their sign-in and the door code
(``api/vendor_check_in.py``); this is the organizer's, keyed by the market's id and held to the table's "Check vendors in" row, EDITOR by default, so a
volunteer at the door is added as an editor. It loads through the change loader, so an archived
market's record is never changed, and it writes through ``record_attendance``, so the two doors
record alike.

**The door code** is one live code per market, stored on the market document as ``doorCode``
(``{code, madeAt, madeBy}``) and served only here: no market read serves it
(``market_documents.leave_out_what_no_read_serves``), since a Viewer who read it could check
vendors in by proxy. Reading and making it are held to the same "Check vendors in" row; making it
loads through the change loader and only in ``market_days``. A new code replaces the old, which
ends every poster of it; it is recorded in the market's history without the code itself. A code a
vendor sends is compared here (``door_code_matches``), so the live code never leaves this module.
"""
import hmac
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple
from urllib.parse import quote

import api.attendance as AttendanceApi
import api.market_actions as Actions
import api.markets as MarketsApi
import history as History
from datatypes import MarketPhase
from market_documents import market_doc_key
from utils.email import frontend_url

NOT_PUBLISHED = "Vendors are checked in once the market is published."
NO_DOOR_CODE_YET = "A door code is made once the market is published."

#: No 0, O, 1 or I, which a vendor typing the code from a poster would mistake for each other.
DOOR_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
DOOR_CODE_LENGTH = 6
DOOR_CODE_KEY = market_doc_key("door_code")


def _market_on_its_days(market_id: str, requesting_user: str):
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.CHECK_IN)
    return market if market.phase is MarketPhase.MARKET_DAYS else None


def check_in(
    market_id: str, vendor_email: str, date: str, requesting_user: str,
) -> Tuple[Dict[str, Any], int]:
    """Record that a vendor is here on this date, made by ``requesting_user``."""
    if _market_on_its_days(market_id, requesting_user) is None:
        return {"error": NOT_PUBLISHED}, 409
    return AttendanceApi.record_attendance(
        market_id, vendor_email, date, checked_in_by=requesting_user,
    )


def undo_check_in(
    market_id: str, vendor_email: str, date: str, requesting_user: str,
) -> Tuple[Dict[str, Any], int]:
    """Take back a check-in on this date, whoever made it."""
    if _market_on_its_days(market_id, requesting_user) is None:
        return {"error": NOT_PUBLISHED}, 409
    return AttendanceApi.undo_attendance(market_id, vendor_email, date, undone_by=requesting_user)


def new_door_code() -> str:
    """Six characters of ``DOOR_CODE_ALPHABET``, each drawn by ``secrets``."""
    return "".join(secrets.choice(DOOR_CODE_ALPHABET) for _ in range(DOOR_CODE_LENGTH))


def door_url(slug: str, code: str) -> str:
    """The vendor page with the code, which the QR code opens: ``<app>/<slug>?door=<code>``."""
    return f"{frontend_url()}/{quote(slug, safe='')}?door={quote(code, safe='')}"


def normalized_door_code(typed: str) -> str:
    """A typed code as the poster prints it: upper case, its spaces and dashes dropped ("k7m-4qp"
    and "K7M 4QP" are "K7M4QP")."""
    return "".join(typed.split()).replace("-", "").upper()


def door_code_matches(market_id: str, typed: Optional[str]) -> bool:
    """Is ``typed`` this market's live door code? Compared in constant time; a market with no code
    yet matches nothing."""
    held = _held_code(market_id)
    if held is None or not isinstance(typed, str):
        return False
    return hmac.compare_digest(
        normalized_door_code(typed).encode("utf-8"), str(held["code"]).encode("utf-8"))


def _held_code(market_id: str) -> Optional[Dict[str, Any]]:
    document = MarketsApi.markets_collection.find_one(
        {market_doc_key("id"): market_id}, {DOOR_CODE_KEY: 1})
    held = (document or {}).get(DOOR_CODE_KEY)
    return held if isinstance(held, dict) and held.get("code") else None


def _served(slug: str, held: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if held is None:
        return {"code": None}
    return {
        "code": held["code"],
        "madeAt": held.get("madeAt"),
        "madeBy": held.get("madeBy"),
        "url": door_url(slug, held["code"]),
    }


def door_code(market_id: str, requesting_user: str) -> Dict[str, Any]:
    """The market's live door code, ``{code, madeAt, madeBy, url}``, or ``{code: None}``."""
    market = MarketsApi._load_market_for(market_id, requesting_user, Actions.CHECK_IN)
    return _served(market.slug, _held_code(market_id))


def make_door_code(market_id: str, requesting_user: str) -> Tuple[Dict[str, Any], int]:
    """Make a new door code, the first or a replacement, which ends the old one at once."""
    market = _market_on_its_days(market_id, requesting_user)
    if market is None:
        return {"error": NO_DOOR_CODE_YET}, 409
    before = _held_code(market_id)
    made = {
        "code": new_door_code(),
        "madeAt": datetime.now(timezone.utc).isoformat(),
        "madeBy": requesting_user,
    }
    # Filtered on the phase as well, so a market archived since it was loaded is not changed.
    written = MarketsApi.markets_collection.update_one(
        {market_doc_key("id"): market_id,
         market_doc_key("phase"): MarketPhase.MARKET_DAYS.value},
        {"$set": {DOOR_CODE_KEY: made}},
    )
    if not written.matched_count:
        return {"error": NO_DOOR_CODE_YET}, 409
    History.record(
        market_id, requesting_user, Actions.CHECK_IN, kind=History.DOOR_CODE_MADE,
        detail={"replaced": before is not None},
    )
    return _served(market.slug, made), 200
