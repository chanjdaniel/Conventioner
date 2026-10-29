"""An organizer checks a vendor in at the door, or undoes it (E29/F01/S02).

The vendor's own check-in is public and keyed by the market's address; this is the organizer's,
keyed by the market's id and held to the table's "Check vendors in" row, EDITOR by default, so a
volunteer at the door is added as an editor. It loads through the change loader, so an archived
market's record is never changed, and it writes through ``record_attendance``, so the two doors
record alike.
"""
from typing import Any, Dict, Tuple

import api.attendance as AttendanceApi
import api.market_actions as Actions
import api.markets as MarketsApi
from datatypes import MarketPhase

NOT_PUBLISHED = "Vendors are checked in once the market is published."


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
    return AttendanceApi.undo_attendance(market_id, vendor_email, date)
