"""A vendor checks themselves in at the door, on their own vendor page (ADR 0022).

The check-in used to be public: anyone with the market's address typed any vendor's email, read
their seats and checked them in or out, so a check-in proved nothing about who was at the door. It
is now the vendor's own, and proves two things: who they are, by their sign-in (the Bearer token
the emailed code or a remembered device gave them), and that they are at the door, by the door
code the organizer shows at the entrance (``api/door.py``), scanned from its QR code or typed.

Both endpoints are attacker-facing, so:

- every check-in attempt, right code or wrong, is counted per signed-in address
  (``sign_in_limits``), and nothing per caller: a venue's wifi is one caller for every vendor
  there, and a count of wrong codes from it refused a right code after strangers' wrong ones
  (T318). That bound, the sign-in for this market and a seat on a day in reach are what bound a
  guess at the door code;
- the market goes through the vendor page gate (``vendor_page_market_by_slug``), so a market with
  no vendor page answers exactly as a slug that names nothing;
- a token for another market is refused, as the vendor's own read refuses it;
- each refusal has its own sentence and writes nothing, and none carries the door code.

A check-in is for a date the vendor has a seat on, in ``market_days``, within one day of the
server's UTC date (``AttendanceApi.within_the_window``: so whatever the vendor's time zone, "today"
for them is in reach, and a code read today cannot check them in for next week). The undo takes no
door code, and the same window: on that day it takes back what the vendor themselves, or an
organizer, recorded.
"""
from typing import Any, Dict, Optional, Tuple

from flask import jsonify, request

import api.applicants as ApplicantsApi
import api.attendance as AttendanceApi
import api.door as DoorApi
import db_config
import sign_in_limits
from datatypes import MarketPhase, phase_from_market_document
from market_documents import vendor_page_market_by_slug
from utils.request_body import json_object, string_field

SIGN_IN_REQUIRED = "Authentication required. Your session may have expired. Please sign in again."
ANOTHER_MARKET = "Your sign-in is for a different market. Please sign in again."
NO_SEAT = "You have no table on this date."
NOT_TODAY = "Check-in is open on the day itself."
WRONG_DOOR_CODE = "That isn't this market's door code. Check it, or ask at the door."
NOT_YET = "Check-in opens when the market's days begin."


def _too_many(retry_after: Optional[int]):
    """The check-in's refusal for a limit that says to wait, or None (``sign_in_limits.too_many``)."""
    return sign_in_limits.too_many(
        retry_after, "Too many check-in attempts. Please try again in {wait}.", key="error")


def _refused(message: str, status: int):
    return jsonify({"error": message}), status


def _signed_in_vendor():
    """The request's sign-in, ``(token_payload, None)``, or ``(None, refusal)`` without one."""
    token = ApplicantsApi.authenticate_request(request.headers.get("Authorization"))
    if not token:
        return None, _refused(SIGN_IN_REQUIRED, 401)
    return token, None


def _market_on_its_days(market_slug: str, token: Dict[str, Any]):
    """The market at this slug, if the vendor's sign-in is for it and it is in its days; else the
    refusal, in the order a vendor would want it told."""
    market_doc = vendor_page_market_by_slug(
        db_config.get_database()["markets"], market_slug, fields=("id", "assignmentObject"))
    if not market_doc:
        return None, _refused(ApplicantsApi.MARKET_NOT_FOUND, 404)
    if token.get("market_id") != market_doc.get("id"):
        return None, _refused(ANOTHER_MARKET, 403)
    phase = phase_from_market_document(market_doc)
    if phase is MarketPhase.ARCHIVED:
        return None, _refused(AttendanceApi.ENDED_REFUSAL, 409)
    if phase is not MarketPhase.MARKET_DAYS:
        return None, _refused(NOT_YET, 409)
    return market_doc, None


def check_in(market_slug: str) -> Tuple[Any, int]:
    """Handle POST /public/markets/<slug>/vendor/check-in ``{date, doorCode}``."""
    token, refused = _signed_in_vendor()
    if refused:
        return refused
    email = token["email"]
    refused = _too_many(sign_in_limits.count_attempt(sign_in_limits.CHECK_IN_PER_ADDRESS, email))
    if refused:
        return refused

    data = json_object(required=False)
    day = (string_field(data, "date") or "").strip()
    market_doc, refused = _market_on_its_days(market_slug, token)
    if refused:
        return refused
    if not day or not AttendanceApi.seated_on(market_doc, email, day):
        return _refused(NO_SEAT, 404)
    if not AttendanceApi.within_the_window(day):
        return _refused(NOT_TODAY, 409)
    if not DoorApi.door_code_matches(market_doc["id"], string_field(data, "doorCode")):
        return _refused(WRONG_DOOR_CODE, 403)

    result, status = AttendanceApi.record_attendance(
        market_doc["id"], email, day, checked_in_by=None, via=AttendanceApi.VIA_DOOR_CODE)
    return jsonify(result), status


def undo_check_in(market_slug: str) -> Tuple[Any, int]:
    """Handle DELETE /public/markets/<slug>/vendor/check-in ``{date}``: the vendor's check-in on
    that date taken back, in the market's days, with no door code.

    Counts nothing against a limit: it is bounded by the sign-in, ``market_days`` and a day within
    one of the server's, so a vendor never erases a past day's attendance. On that day it takes
    back whatever check-in is stored, theirs or one an organizer made at Attendance: it is the
    record of their own presence, the history says who undid it, and the door code checks them in
    again.
    """
    token, refused = _signed_in_vendor()
    if refused:
        return refused
    day = (string_field(json_object(required=False), "date") or "").strip()
    market_doc, refused = _market_on_its_days(market_slug, token)
    if refused:
        return refused
    # A missing date is the undo's own 400, below; a date given must be within the window.
    if day and not AttendanceApi.within_the_window(day):
        return _refused(NOT_TODAY, 409)
    result, status = AttendanceApi.undo_attendance(
        market_doc["id"], token["email"], day, undone_by=None, via=AttendanceApi.VIA_VENDOR_PAGE)
    return jsonify(result), status
