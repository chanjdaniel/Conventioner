"""Single owner of what a vendor owes and what they have paid (E44/F01/S01).

Conventioner tracks what is expected and what came in, not accounting (Daniel, T92 Q5): vendors pay
outside the app, by e-transfer or cash (Q7), and an organizer records each payment here.

- **The amount owed is kept per table-day** (Q26): by default the price of the seat the vendor holds
  that day, priced as the drawer's date cards price it (``pricing.Groups``), so it follows the seat
  while nobody has set it by hand.
  An amount set by hand (``set_amount_owed``, an Admin's by default) holds whatever the seat does,
  until ``use_calculated_price`` takes it back; setting $0 is how a fee is waived.
- **Freeing a table never changes either amount by itself** (Q26: after the cancellation deadline
  "the amount owed and amount paid dont change even though the table did"): the seat's line is kept
  as it stood when it was freed (``keep_freed_line``), still owed, until someone sets the amount.
- **The amount paid is the sum of the vendor's entries still standing**, each with who recorded it
  and when (Q15): a payment, or a refund an Admin records as a negative entry once it is given back
  (Q26). An edit or a removal keeps what the entry read before in its own ``changes``, and a removed
  entry is kept, marked, rather than deleted.

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
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

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
    #: The card's row that set the price: a price group's name, "Everyone else" on a card with
    #: groups, or None on a card without (E43/F01/S02).
    group: Optional[str] = None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _vendor(market_id: str, vendor_email: str) -> Dict[str, str]:
    return {MARKET_ID_FIELD: market_id, VENDOR_EMAIL_FIELD: normalized_email(vendor_email)}


# --- The amount paid ------------------------------------------------------------------------------

#: An entry is a payment the vendor made, or a refund an Admin gave back (E44/F01/S02), stored as a
#: negative amount so the amount paid is the sum of every entry still standing.
PAYMENT = "payment"
REFUND = "refund"

#: An entry's fields as a person gives them, and as an edit or a removal records them.
ENTRY_FIELDS = ("cents", "method", "paid_on", "note")


def _signed(entry: PaymentEntry, kind: str) -> Dict[str, Any]:
    fields = entry.model_dump()
    if kind == REFUND:
        fields["cents"] = -fields["cents"]
    return fields


def record_payment(
    market_id: str, vendor_email: str, entry: PaymentEntry, by: str, kind: str = PAYMENT,
) -> Dict[str, Any]:
    """Keep one payment, or a refund, with who recorded it and when. Returns it as stored."""
    stored = {
        "id": str(uuid.uuid4()),
        **_vendor(market_id, vendor_email),
        "kind": kind,
        **_signed(entry, kind),
        "recorded_by": by,
        "recorded_at": _now(),
    }
    payments_collection.insert_one(dict(stored))
    return stored


def payment(market_id: str, payment_id: str) -> Optional[Dict[str, Any]]:
    """One entry of this market, removed or not, or None."""
    return payments_collection.find_one({MARKET_ID_FIELD: market_id, "id": payment_id})


def _trail(doc: Mapping[str, Any], by: str, what: str) -> Dict[str, Any]:
    """One line of an entry's own history: who changed it, when, and what it read before."""
    return {"by": by, "at": _now(), "what": what,
            "before": {key: doc.get(key) for key in ENTRY_FIELDS}}


def edit_payment(
    market_id: str, payment_id: str, entry: PaymentEntry, by: str,
) -> Optional[Dict[str, Any]]:
    """Change a standing entry's fields, keeping what it read before in its own history. Returns
    the entry as it now reads, or None when this market has no such entry standing."""
    doc = payment(market_id, payment_id)
    if doc is None or doc.get("removed_at"):
        return None
    payments_collection.update_one(
        {MARKET_ID_FIELD: market_id, "id": payment_id},
        {"$set": _signed(entry, doc.get("kind") or PAYMENT),
         "$push": {"changes": _trail(doc, by, "edited")}},
    )
    return payment(market_id, payment_id)


def remove_payment(market_id: str, payment_id: str, by: str) -> Optional[Dict[str, Any]]:
    """Take a standing entry out of the amount paid. It is kept, marked removed with who and
    when, so its own history stands. Returns it as it now reads, or None when there is none."""
    doc = payment(market_id, payment_id)
    if doc is None or doc.get("removed_at"):
        return None
    payments_collection.update_one(
        {MARKET_ID_FIELD: market_id, "id": payment_id},
        {"$set": {"removed_by": by, "removed_at": _now()},
         "$push": {"changes": _trail(doc, by, "removed")}},
    )
    return payment(market_id, payment_id)


def payments_for(market_id: str, vendor_email: str) -> List[Dict[str, Any]]:
    """One vendor's entries, removed ones too, the last recorded first."""
    found = payments_collection.find(_vendor(market_id, vendor_email))
    return sorted(found, key=lambda doc: doc.get("recorded_at") or "", reverse=True)


def payments_by_vendor(market_id: str) -> Dict[str, List[Dict[str, Any]]]:
    """Every vendor's entries on the market, removed ones too, by vendor, in one read."""
    found: Dict[str, List[Dict[str, Any]]] = {}
    for doc in payments_collection.find({MARKET_ID_FIELD: market_id}):
        found.setdefault(doc.get(VENDOR_EMAIL_FIELD) or "", []).append(doc)
    return found


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


def clear_freed_lines(
    market_id: str, seated: Iterable[Tuple[str, str]],
) -> List[Tuple[str, str, int]]:
    """Forget the freed line of each ``(vendor, date)`` seated again: the line reads the new seat,
    and a freed record left behind would come back as the line if that seat went some other way
    than a free. A $0 the free's deduction set goes with it, since it was about the freed table;
    an amount an Admin set by hand stays, as it holds whatever the seat does.

    Returns each deduction taken back, ``(vendor, date, cents)``, for the history to record.
    """
    wanted = {(normalized_email(email), date) for email, date in seated}
    taken_back: List[Tuple[str, str, int]] = []
    if not wanted:
        return taken_back
    for doc in amounts_owed_collection.find({MARKET_ID_FIELD: market_id}):
        key = (doc.get(VENDOR_EMAIL_FIELD), doc.get("date"))
        if doc.get("freed") and key in wanted:
            cleared: Dict[str, Any] = {"freed": None}
            deduction = doc.get("set_by_hand") or {}
            if deduction.get("by_free"):
                cleared["set_by_hand"] = None
                taken_back.append((key[0], key[1], deduction.get("cents") or 0))
            amounts_owed_collection.update_one(_owed_key(market_id, *key), {"$set": cleared})
    return taken_back


def set_amount_owed(
    market_id: str, vendor_email: str, date: str, cents: int, by: str, by_free: bool = False,
) -> None:
    """Set what a vendor owes for one table-day by hand, over what the pricing calculates.
    ``by_free`` marks the $0 a free's deduction sets, which seating the day again takes back."""
    set_by_hand: Dict[str, Any] = {"cents": cents, "by": by, "at": _now()}
    if by_free:
        set_by_hand["by_free"] = True
    amounts_owed_collection.find_one_and_update(
        _owed_key(market_id, vendor_email, date), {"$set": {"set_by_hand": set_by_hand}},
        upsert=True,
    )


def use_calculated_price(market_id: str, vendor_email: str, date: str) -> None:
    """Take back an amount set by hand: the line owes what the pricing calculates again."""
    amounts_owed_collection.find_one_and_update(
        _owed_key(market_id, vendor_email, date), {"$set": {"set_by_hand": None}},
    )


def amounts_owed_for(market_id: str, vendor_email: str) -> Dict[str, Dict[str, Any]]:
    """What is kept of one vendor's table-days, by date."""
    return {
        doc["date"]: doc
        for doc in amounts_owed_collection.find(_vendor(market_id, vendor_email))
    }


def amounts_owed_by_vendor(market_id: str) -> Dict[str, Dict[str, Dict[str, Any]]]:
    """What is kept of every vendor's table-days on the market, by vendor and date, in one read."""
    found: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for doc in amounts_owed_collection.find({MARKET_ID_FIELD: market_id}):
        found.setdefault(doc.get(VENDOR_EMAIL_FIELD) or "", {})[doc["date"]] = doc
    return found


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
                               for key in ("table_code", "tier", "table_choice", "cents", "group")})
        by_hand = (kept.get(date) or {}).get("set_by_hand")
        found.append({
            "date": date,
            "tableCode": seat.table_code,
            "tier": seat.tier,
            "tableChoice": seat.table_choice,
            "group": seat.group,
            "priceCents": seat.cents,
            "owedCents": by_hand["cents"] if by_hand else seat.cents,
            "owedSetBy": by_hand["by"] if by_hand else None,
            "owedSetAt": by_hand["at"] if by_hand else None,
            # Set by the free that asked "Also remove its $35 …?", not by hand: seating the day
            # again takes it back, so the tab says which amounts hold.
            "owedByFree": bool(by_hand and by_hand.get("by_free")),
            "freed": held is None,
            "freedAt": freed.get("at") if freed else None,
            "freedBy": freed.get("by") if freed else None,
        })
    return found


def _payment(doc: Mapping[str, Any]) -> Dict[str, Any]:
    edits = [change for change in doc.get("changes") or [] if change.get("what") == "edited"]
    return {
        "id": doc.get("id"),
        "kind": doc.get("kind") or PAYMENT,
        "cents": doc.get("cents"),
        "method": doc.get("method"),
        "paidOn": doc.get("paid_on"),
        "note": doc.get("note") or "",
        "recordedBy": doc.get("recorded_by"),
        "recordedAt": doc.get("recorded_at"),
        "editedBy": edits[-1]["by"] if edits else None,
        "editedAt": edits[-1]["at"] if edits else None,
        "removedBy": doc.get("removed_by"),
        "removedAt": doc.get("removed_at"),
    }


def account(
    currency: Optional[str], day_lines: List[Dict[str, Any]], paid: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """A vendor's account as the drawer's Payment tab reads it: each line, each entry, and the
    two totals. An unpriced line owes nothing toward the total, and a removed entry pays nothing."""
    return {
        "currency": currency,
        "lines": day_lines,
        "payments": [_payment(doc) for doc in paid],
        "owedCents": sum(line["owedCents"] or 0 for line in day_lines),
        "paidCents": sum(doc.get("cents") or 0 for doc in paid if not doc.get("removed_at")),
    }


# --- The market's money (E44/F02/S01) -------------------------------------------------------------

def _figures(owed: int, paid: int) -> Dict[str, int]:
    """What the Payments page counts, for a vendor, a day, a tier, a date or the market."""
    return {"owedCents": owed, "paidCents": paid,
            "stillOwedCents": max(owed - paid, 0), "paidMoreCents": max(paid - owed, 0)}


def shares(cents: int, weights: List[int]) -> List[int]:
    """``cents`` split across ``weights`` in proportion, to the cent: each takes its whole share,
    and the cents left over go to the largest remainders, the earlier first, so nothing is lost.
    Every weight is at least 0 and one at least is above it."""
    total = sum(weights)
    whole = abs(cents)
    exact = [whole * weight for weight in weights]
    split = [part // total for part in exact]
    left = whole - sum(split)
    for i in sorted(range(len(weights)), key=lambda i: (-(exact[i] % total), i))[:left]:
        split[i] += 1
    return [-part for part in split] if cents < 0 else split


def market_summary(
    accounts: Mapping[str, Mapping[str, Any]], tier_order: List[str],
) -> Dict[str, Any]:
    """The Payments page from every vendor's account: each vendor with a line or a payment, by
    address, and the market's figures, also by tier and by date.

    A payment is a vendor's, never a day's, so what a vendor paid is shared across their table-days
    in proportion to what each owes, or evenly where they owe nothing, and each day's share counts
    toward its tier and its date; what a vendor with no line paid is counted apart, under neither
    (``None``). A vendor's days are all owing or all paid more, so the still owed and the paid more
    of every breakdown add up to the market's, which are each vendor's own, summed.
    """
    vendors: List[Dict[str, Any]] = []
    totals = _figures(0, 0)
    by_tier: Dict[Optional[str], Dict[str, int]] = {}
    by_date: Dict[Optional[str], Dict[str, int]] = {}

    def add(into: Dict[str, int], owed: int, paid: int) -> None:
        for key, value in _figures(owed, paid).items():
            into[key] += value

    for email in sorted(accounts):
        held = accounts[email]
        if not held["lines"] and not held["payments"]:
            continue
        vendors.append({"email": email, "owedCents": held["owedCents"],
                        "paidCents": held["paidCents"]})
        add(totals, held["owedCents"], held["paidCents"])
        owed = [line["owedCents"] or 0 for line in held["lines"]]
        if not owed:
            parts = [(None, None, 0, held["paidCents"])]
        else:
            paid = shares(held["paidCents"], owed if sum(owed) else [1] * len(owed))
            parts = [((line["tier"] or "").strip() or None, line["date"], cents, share)
                     for line, cents, share in zip(held["lines"], owed, paid)]
        for tier, date, cents, share in parts:
            add(by_tier.setdefault(tier, _figures(0, 0)), cents, share)
            add(by_date.setdefault(date, _figures(0, 0)), cents, share)

    def tier_place(tier: Optional[str]) -> Tuple[int, int, str]:
        if tier is None:
            return (2, 0, "")
        if tier in tier_order:
            return (0, tier_order.index(tier), tier)
        return (1, 0, tier)

    return {
        "vendors": vendors,
        "totals": totals,
        "byTier": [{"tier": tier, **by_tier[tier]} for tier in sorted(by_tier, key=tier_place)],
        "byDate": [{"date": date, **by_date[date]}
                   for date in sorted(by_date, key=lambda date: (date is None, date or ""))],
    }


def delete_for_market(market_id: str) -> int:
    """Take a market's payments and amounts owed with the market. Returns how many went."""
    query = {MARKET_ID_FIELD: market_id}
    return (
        payments_collection.delete_many(query).deleted_count
        + amounts_owed_collection.delete_many(query).deleted_count
    )
