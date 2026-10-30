"""A vendor's payments, as the organizers read and record them (E44/F01/S01).

The drawer's Payment tab reads one vendor's account here: a line per table-day with what they owe
for it, each payment recorded, and the two totals. The lines are read off the market's stored
assignment, the same rows and the same pricing the drawer's date cards read (``get_market_tables``),
so a line and its date card never disagree; ``payments.py`` keeps what the assignment cannot say.

Reading asks ``Actions.READ``: everyone with a role reads it, and no applicant endpoint does
(Q20.2). Recording asks ``Actions.RECORD_PAYMENT``, an Editor's by default (Q15), and an archived
market refuses it.
"""
from typing import Any, Dict

from pydantic import ValidationError

import api.applications as ApplicationsApi
import api.market_actions as Actions
import api.markets as MarketsApi
from assignment.utils import convert_keys_to_snake_case
from client_errors import BadRequestError, NotFoundError, field_named_copy
from datatypes import Market, PaymentEntry
import history as History
import payments as Payments
import pricing as Pricing
from utils.email_address import normalized_email

#: A payment's fields as its history entry records them, before (none) and after.
_RECORDED_FIELDS = ("cents", "method", "paid_on", "note")


def seats_by_vendor(market: Market) -> Dict[str, Dict[str, Payments.Seat]]:
    """Every seat held on the market, by vendor and date, each with its price that day."""
    pricing = market.setup_object.pricing if market.setup_object else None
    seats: Dict[str, Dict[str, Payments.Seat]] = {}
    for row in MarketsApi.derive_market_table_rows(market):
        cents = Pricing.assignment_price(pricing, row.tier, row.table_choice)
        for email in dict.fromkeys(email for email in row.assignment if email):
            seats.setdefault(normalized_email(email), {})[row.date] = Payments.Seat(
                row.table_code, row.tier, row.table_choice, cents)
    return seats


def _account(market: Market, vendor_email: str) -> Dict[str, Any]:
    pricing = market.setup_object.pricing if market.setup_object else None
    address = normalized_email(vendor_email)
    return Payments.account(
        pricing.currency if pricing else None,
        Payments.lines(seats_by_vendor(market).get(address, {}),
                       Payments.amounts_owed_for(market.id, address)),
        Payments.payments_for(market.id, address),
    )


def vendor_account(market_id: str, vendor_email: str, requesting_user: str) -> Dict[str, Any]:
    """One vendor's account on this market. Asks ``Actions.READ``."""
    market = MarketsApi._load_market_for(market_id, requesting_user, Actions.READ)
    return _account(market, vendor_email)


def record_payment(
    market_id: str, vendor_email: str, body: Any, requesting_user: str,
) -> Dict[str, Any]:
    """Record one payment a vendor made, ``{cents, method, paidOn, note}``, and answer their
    account as it now reads. Asks ``Actions.RECORD_PAYMENT``; an archived market refuses it.

    A payment is only ever a vendor's of this market: someone it has no application from is
    refused, as a seat is.
    """
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.RECORD_PAYMENT)
    address = normalized_email(vendor_email)
    if not address or ApplicationsApi.find_application_by_email(market_id, address) is None:
        raise NotFoundError("This market has no application from that vendor.")
    try:
        entry = PaymentEntry.model_validate(
            convert_keys_to_snake_case(body) if isinstance(body, dict) else body)
    except ValidationError as e:
        raise BadRequestError(field_named_copy("The payment cannot be recorded", e)) from e

    stored = Payments.record_payment(market_id, address, entry, requesting_user)
    History.record(
        market_id, requesting_user, Actions.RECORD_PAYMENT, vendors=[address],
        subject={"payment_id": stored["id"]},
        detail=lambda: History.changes(dict.fromkeys(_RECORDED_FIELDS),
                                       {key: stored[key] or None for key in _RECORDED_FIELDS}),
    )
    return _account(market, address)


def keep_freed_line(market: Market, vendor_email: str, date: str, by: str) -> None:
    """Keep the line of the seat a vendor holds on ``date``, which is about to be freed: freeing a
    table changes neither what they owe nor what they paid (Q26)."""
    seat = seats_by_vendor(market).get(normalized_email(vendor_email), {}).get(date)
    if seat is not None:
        Payments.keep_freed_line(market.id, vendor_email, date, seat, by)
