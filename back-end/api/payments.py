"""A vendor's payments, as the organizers read and record them (E44/F01/S01).

The drawer's Payment tab reads one vendor's account here: a line per table-day with what they owe
for it, each payment recorded, and the two totals. The lines are read off the market's stored
assignment, the same rows and the same pricing the drawer's date cards read (``get_market_tables``),
so a line and its date card never disagree; ``payments.py`` keeps what the assignment cannot say.

Reading asks ``Actions.READ``: everyone with a role reads it, and no applicant endpoint does
(Q20.2). Recording a payment asks ``Actions.RECORD_PAYMENT``, an Editor's by default (Q15);
changing a table-day's amount owed asks ``Actions.CHANGE_OWED``, and recording a refund or editing
or removing an entry ``Actions.ADJUST_PAID``, each an Admin's by default (Q26, E44/F01/S02). An
archived market refuses every write.
"""
from typing import Any, Dict, List, Optional, Tuple

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

#: The most a table-day may be set to owe: what a price cell may hold, $100,000.
MOST_OWED_CENTS = 10_000_000

NO_LINE = "That vendor holds no table that day, so nothing is owed for it."
NO_ENTRY = "This market has no such payment standing."


def seats_by_vendor(market: Market) -> Dict[str, Dict[str, Payments.Seat]]:
    """Every seat held on the market, by vendor and date, each with its price that day and the
    card's row that set it: the price groups the vendor's answers put them in (E43/F01/S02), as
    the tables read prices the date cards (``Pricing.row_prices``)."""
    groups = Pricing.Groups(market)
    answers = Pricing.vendor_answers(groups, market.id)
    seats: Dict[str, Dict[str, Payments.Seat]] = {}
    for row in MarketsApi.derive_market_table_rows(market):
        priced = {normalized_email(price["email"]): price
                  for price in Pricing.row_prices(groups, row, answers)}
        for email in dict.fromkeys(normalized_email(email) for email in row.assignment if email):
            price = priced.get(email) or {}
            seats.setdefault(email, {})[row.date] = Payments.Seat(
                row.table_code, row.tier, row.table_choice, price.get("cents"), price.get("group"))
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


def _entry(body: Any, what: str) -> PaymentEntry:
    """A request body as an entry, or a refusal naming each field it gets wrong."""
    try:
        return PaymentEntry.model_validate(
            convert_keys_to_snake_case(body) if isinstance(body, dict) else body)
    except ValidationError as e:
        raise BadRequestError(field_named_copy(f"The {what} cannot be recorded", e)) from e


def _applicant(market_id: str, vendor_email: str) -> str:
    """The vendor's address, once the market has an application from them: money is only ever
    a vendor's of this market, as a seat is."""
    address = normalized_email(vendor_email)
    if not address or ApplicationsApi.find_application_by_email(market_id, address) is None:
        raise NotFoundError("This market has no application from that vendor.")
    return address


def _fields(doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """An entry's fields as its history records them; all None for an entry not there."""
    return {key: (doc or {}).get(key) or None for key in Payments.ENTRY_FIELDS}


def _record_entry(
    market_id: str, vendor_email: str, body: Any, requesting_user: str, kind: str,
) -> Dict[str, Any]:
    row = Actions.RECORD_PAYMENT if kind == Payments.PAYMENT else Actions.ADJUST_PAID
    market = MarketsApi._load_market_to_change(market_id, requesting_user, row)
    address = _applicant(market_id, vendor_email)
    entry = _entry(body, kind)
    stored = Payments.record_payment(market_id, address, entry, requesting_user, kind)
    History.record(
        market_id, requesting_user, row,
        kind=None if kind == Payments.PAYMENT else History.REFUND_RECORDED, vendors=[address],
        subject={"payment_id": stored["id"], "payment_kind": kind, **_currency(market)},
        detail=lambda: History.changes(_fields(None), _fields(stored)),
    )
    return _account(market, address)


def record_payment(
    market_id: str, vendor_email: str, body: Any, requesting_user: str,
) -> Dict[str, Any]:
    """Record one payment a vendor made, ``{cents, method, paidOn, note}``, and answer their
    account as it now reads. Asks ``Actions.RECORD_PAYMENT``; an archived market refuses it, and
    so does a vendor it has no application from."""
    return _record_entry(market_id, vendor_email, body, requesting_user, Payments.PAYMENT)


def record_refund(
    market_id: str, vendor_email: str, body: Any, requesting_user: str,
) -> Dict[str, Any]:
    """Record money given back to a vendor, the same fields as a payment, kept as a negative entry
    (Q26: "when the refund is settled they can come back and adjust amount paid"). Asks
    ``Actions.ADJUST_PAID``."""
    return _record_entry(market_id, vendor_email, body, requesting_user, Payments.REFUND)


def _change_entry(
    market_id: str, payment_id: str, requesting_user: str, body: Any = None,
) -> Dict[str, Any]:
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.ADJUST_PAID)
    before = Payments.payment(market_id, str(payment_id or ""))
    if before is None or before.get("removed_at"):
        raise NotFoundError(NO_ENTRY)
    if body is None:
        after, kind = Payments.remove_payment(market_id, before["id"], requesting_user), \
            History.PAYMENT_REMOVED
        recorded_after: Optional[Dict[str, Any]] = None
    else:
        entry = _entry(body, before.get("kind") or Payments.PAYMENT)
        after, kind = Payments.edit_payment(market_id, before["id"], entry, requesting_user), \
            History.PAYMENT_EDITED
        recorded_after = after
    if after is None:
        raise NotFoundError(NO_ENTRY)
    History.record(
        market_id, requesting_user, Actions.ADJUST_PAID, kind=kind,
        vendors=[before.get("vendor_email")],
        subject={"payment_id": before["id"],
                 "payment_kind": before.get("kind") or Payments.PAYMENT, **_currency(market)},
        detail=lambda: History.changes(_fields(before), _fields(recorded_after)),
    )
    return _account(market, before.get("vendor_email") or "")


def edit_payment(
    market_id: str, payment_id: str, body: Any, requesting_user: str,
) -> Dict[str, Any]:
    """Change a payment or a refund's amount, method, day or note; what it read before is kept in
    its own history. Asks ``Actions.ADJUST_PAID``."""
    return _change_entry(market_id, payment_id, requesting_user, body)


def remove_payment(market_id: str, payment_id: str, requesting_user: str) -> Dict[str, Any]:
    """Take a payment or a refund out of the amount paid; it is kept, marked removed. Asks
    ``Actions.ADJUST_PAID``."""
    return _change_entry(market_id, payment_id, requesting_user)


def _line(market: Market, address: str, date: str) -> Optional[Dict[str, Any]]:
    return next((line for line in _account(market, address)["lines"] if line["date"] == date),
                None)


def _owed_cents(body: Any) -> int:
    cents = body.get("cents") if isinstance(body, dict) else None
    if isinstance(cents, bool) or not isinstance(cents, int) or not 0 <= cents <= MOST_OWED_CENTS:
        raise BadRequestError(
            "An amount owed is a whole number of cents from 0 to 10000000 ($100,000).")
    return cents


def _currency(market: Market) -> Dict[str, Any]:
    """The market's currency, in a payment entry's subject, so its money reads in it."""
    return Pricing.pricing_subject(market.setup_object)


def _record_owed(
    market: Market, requesting_user: str, address: str, date: str, kind: str,
    before: Dict[str, Any], after: Optional[Dict[str, Any]],
) -> None:
    History.record(
        market.id, requesting_user, Actions.CHANGE_OWED, kind=kind, vendors=[address],
        subject={"date": date, **_currency(market)},
        detail=lambda: History.changes({"owed_cents": before["owedCents"]},
                                       {"owed_cents": (after or {}).get("owedCents")}),
    )


def set_amount_owed(
    market_id: str, vendor_email: str, date: str, body: Any, requesting_user: str,
) -> Dict[str, Any]:
    """Set what a vendor owes for one table-day, ``{cents}``, $0 being how a fee is waived (Q26).
    Asks ``Actions.CHANGE_OWED``; a day with no line, held or freed, is refused."""
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.CHANGE_OWED)
    address = normalized_email(vendor_email)
    cents = _owed_cents(body)
    before = _line(market, address, date)
    if before is None:
        raise NotFoundError(NO_LINE)
    Payments.set_amount_owed(market_id, address, date, cents, requesting_user)
    account = _account(market, address)
    _record_owed(market, requesting_user, address, date, History.OWED_SET, before,
                 _line(market, address, date))
    return account


def use_calculated_price(
    market_id: str, vendor_email: str, date: str, requesting_user: str,
) -> Dict[str, Any]:
    """Take back an amount set by hand on one table-day: it owes the calculated price again.
    Asks ``Actions.CHANGE_OWED``."""
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.CHANGE_OWED)
    address = normalized_email(vendor_email)
    before = _line(market, address, date)
    if before is None:
        raise NotFoundError(NO_LINE)
    if before["owedSetBy"] is None:
        return _account(market, address)
    Payments.use_calculated_price(market_id, address, date)
    account = _account(market, address)
    _record_owed(market, requesting_user, address, date, History.OWED_CALCULATED, before,
                 _line(market, address, date))
    return account


def keep_freed_line(market: Market, vendor_email: str, date: str, by: str) -> None:
    """Keep the line of the seat a vendor holds on ``date``, which is about to be freed: freeing a
    table changes neither what they owe nor what they paid (Q26)."""
    seat = seats_by_vendor(market).get(normalized_email(vendor_email), {}).get(date)
    if seat is not None:
        Payments.keep_freed_line(market.id, vendor_email, date, seat, by)


def deduct_freed_line(market: Market, vendor_email: str, date: str, by: str) -> None:
    """Free a seat's line of what it owed, as the free that asked it: "Also remove its $15 from
    what they owe?" (Q26). The line stays, owing $0, and the amount paid is untouched, so a vendor
    who paid shows paid more than owed: a refund to issue by hand."""
    address = normalized_email(vendor_email)
    before = _line(market, address, date)
    if before is None:
        return
    Payments.set_amount_owed(market.id, address, date, 0, by, by_free=True)
    _record_owed(market, by, address, date, History.OWED_SET, before,
                 _line(market, address, date))


def seated_again(market_id: str, seated: List[Tuple[str, str]], by: str) -> None:
    """Days seated again, by hand or by a run, forget their freed lines; each deduction a free set
    that goes with them is recorded under the row the seating asked (``Actions.ASSIGN``), as the
    amount it took back and what the day owes now, read off the market as it stands."""
    for address, date, cents in Payments.clear_freed_lines(market_id, seated):
        def detail(address=address, date=date, cents=cents):
            market = MarketsApi.market_from_document(
                MarketsApi.markets_collection.find_one({"id": market_id}))
            line = _line(market, address, date) or {}
            return History.changes({"owed_cents": cents}, {"owed_cents": line.get("owedCents")})

        def subject(date=date):
            market = MarketsApi.market_from_document(
                MarketsApi.markets_collection.find_one({"id": market_id}))
            return {"date": date, **_currency(market)}

        History.record(market_id, by, Actions.ASSIGN, kind=History.OWED_TAKEN_BACK,
                       vendors=[address], subject=subject, detail=detail)
