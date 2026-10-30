"""Single owner of what a vendor owes and what they have paid (E44/F01/S01).

Conventioner tracks what is expected and what came in, not accounting (Daniel, T92 Q5): vendors pay
outside the app, by e-transfer or cash (Q7), and an organizer records each payment here.

- **The amount owed is kept per table-day** (Q26): by default the price of the seat the vendor holds
  that day (``pricing.assignment_price``), so it follows the seat while nobody has set it by hand.
  An amount set by hand (``set_amount_owed``, ticket 20's to offer) holds whatever the seat does.
- **Freeing a table never changes either amount by itself** (Q26: after the cancellation deadline
  "the amount owed and amount paid dont change even though the table did"): the seat's line is kept
  as it stood when it was freed (``keep_freed_line``), still owed, until someone sets the amount.
- **The amount paid is the sum of the vendor's payments**, each with who recorded it and when (Q15).

Two collections, each a record kind keyed by market: ``payments``, one document per payment, and
``amounts_owed``, one document per vendor per table-day that holds something the seat cannot say -
the line of a freed table, or an amount set by hand. A seat held now is read from the market's
assignment, never copied here. Like ``vendor_notes``, no applicant endpoint reads either: what a
vendor owes is the organizers' to read (Q20.2).

Storage contract: snake_case with the market foreign key ``market_id`` and the vendor's address
lowercased; every reader and writer goes through this module, and a market's payments and amounts
owed are deleted with the market (``market_deletion``).
"""
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional

from datatypes import PaymentEntry
from db_config import get_database
from utils.email_address import normalized_email

PAYMENTS_COLLECTION = "payments"
AMOUNTS_OWED_COLLECTION = "amounts_owed"
MARKET_ID_FIELD = "market_id"
VENDOR_EMAIL_FIELD = "vendor_email"

db = get_database()
payments_collection = db[PAYMENTS_COLLECTION]
amounts_owed_collection = db[AMOUNTS_OWED_COLLECTION]


@dataclass(frozen=True)
class Seat:
    """One table-day a vendor holds, and what the pricing says it costs: None where unpriced."""

    table_code: str
    tier: str
    table_choice: str
    cents: Optional[int]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _vendor(market_id: str, vendor_email: str) -> Dict[str, str]:
    return {MARKET_ID_FIELD: market_id, VENDOR_EMAIL_FIELD: normalized_email(vendor_email)}


# --- The amount paid ------------------------------------------------------------------------------

def record_payment(
    market_id: str, vendor_email: str, entry: PaymentEntry, by: str,
) -> Dict[str, Any]:
    """Keep one payment, with who recorded it and when. Returns the payment as stored."""
    stored = {
        "id": str(uuid.uuid4()),
        **_vendor(market_id, vendor_email),
        **entry.model_dump(),
        "recorded_by": by,
        "recorded_at": _now(),
    }
    payments_collection.insert_one(dict(stored))
    return stored


def payments_for(market_id: str, vendor_email: str) -> List[Dict[str, Any]]:
    """One vendor's payments, the last recorded first."""
    found = payments_collection.find(_vendor(market_id, vendor_email))
    return sorted(found, key=lambda doc: doc.get("recorded_at") or "", reverse=True)


# --- The amount owed ------------------------------------------------------------------------------

def _owed_key(market_id: str, vendor_email: str, date: str) -> Dict[str, str]:
    return {**_vendor(market_id, vendor_email), "date": date}


def keep_freed_line(market_id: str, vendor_email: str, date: str, seat: Seat, by: str) -> None:
    """Keep the line of a seat being freed, as it stood: its table and what it cost that day."""
    amounts_owed_collection.find_one_and_update(
        _owed_key(market_id, vendor_email, date),
        {"$set": {"freed": {**asdict(seat), "by": by, "at": _now()}}},
        upsert=True,
    )


def set_amount_owed(market_id: str, vendor_email: str, date: str, cents: int, by: str) -> None:
    """Set what a vendor owes for one table-day by hand, over what the pricing calculates."""
    amounts_owed_collection.find_one_and_update(
        _owed_key(market_id, vendor_email, date),
        {"$set": {"set_by_hand": {"cents": cents, "by": by, "at": _now()}}},
        upsert=True,
    )


def amounts_owed_for(market_id: str, vendor_email: str) -> Dict[str, Dict[str, Any]]:
    """What is kept of one vendor's table-days, by date."""
    return {
        doc["date"]: doc
        for doc in amounts_owed_collection.find(_vendor(market_id, vendor_email))
    }


def lines(
    seats: Mapping[str, Seat], kept: Mapping[str, Mapping[str, Any]],
) -> List[Dict[str, Any]]:
    """A vendor's table-day lines, by date, camelCased for the wire.

    A day they hold a seat on reads that seat and its price; a day whose seat was freed reads the
    seat as it was freed, with who freed it and when, so the line says where its number came from.
    Either way an amount set by hand is what they owe.
    """
    found = []
    for date in sorted({*seats, *(day for day, doc in kept.items() if doc.get("freed"))}):
        held = seats.get(date)
        freed = None if held else kept[date]["freed"]
        seat = held or Seat(**{key: freed.get(key)
                               for key in ("table_code", "tier", "table_choice", "cents")})
        by_hand = (kept.get(date) or {}).get("set_by_hand")
        found.append({
            "date": date,
            "tableCode": seat.table_code,
            "tier": seat.tier,
            "tableChoice": seat.table_choice,
            "priceCents": seat.cents,
            "owedCents": by_hand["cents"] if by_hand else seat.cents,
            "owedSetBy": by_hand["by"] if by_hand else None,
            "owedSetAt": by_hand["at"] if by_hand else None,
            "freed": held is None,
            "freedAt": freed.get("at") if freed else None,
            "freedBy": freed.get("by") if freed else None,
        })
    return found


def _payment(doc: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "id": doc.get("id"),
        "cents": doc.get("cents"),
        "method": doc.get("method"),
        "paidOn": doc.get("paid_on"),
        "note": doc.get("note") or "",
        "recordedBy": doc.get("recorded_by"),
        "recordedAt": doc.get("recorded_at"),
    }


def account(
    currency: Optional[str], day_lines: List[Dict[str, Any]], paid: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """A vendor's account as the drawer's Payment tab reads it: each line, each payment, and the
    two totals. An unpriced line owes nothing toward the total."""
    return {
        "currency": currency,
        "lines": day_lines,
        "payments": [_payment(doc) for doc in paid],
        "owedCents": sum(line["owedCents"] or 0 for line in day_lines),
        "paidCents": sum(doc.get("cents") or 0 for doc in paid),
    }


def delete_for_market(market_id: str) -> int:
    """Take a market's payments and amounts owed with the market. Returns how many went."""
    query = {MARKET_ID_FIELD: market_id}
    return (
        payments_collection.delete_many(query).deleted_count
        + amounts_owed_collection.delete_many(query).deleted_count
    )
