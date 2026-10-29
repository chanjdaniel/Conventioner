"""What a placement costs, read from the market's Pricing card (E43/F01/S01).

A price is for one table on one market day (Daniel, Q4), and it follows the table (Q20): the
table's tier, and whether the seat is the whole table or half of it, even at a tier the vendor did
not pick. Two vendors sharing a table each pay a half table. Prices are whole cents in the market's
one currency; a market with no prices, or a tier the card leaves empty, prices nothing.

The card names tiers and nothing else: no question of any one market's form is read here (Q14).
"""
from typing import Any, Dict, List, Optional

from datatypes import PRICING_CURRENCIES, MarketTableRow, PricingObject, SetupObject

CURRENCIES = PRICING_CURRENCIES


def half_price(cents: int, percent: int) -> int:
    """``percent`` of ``cents``, rounded half up to the cent: 50% of $30.01 is $15.01.

    Integer arithmetic, so no float ever decides a cent.
    """
    return (cents * percent + 50) // 100


def is_half(table_choice: str) -> bool:
    """Whether a seat is half a table: "Half Table", or a side of one."""
    return "half" in (table_choice or "").lower()


def tier_price(pricing: Optional[PricingObject], tier: str) -> Optional[int]:
    """A full table's price at ``tier``, or None where the card gives it none."""
    if pricing is None:
        return None
    return next((price.cents for price in pricing.everyone_else if price.tier == tier), None)


def placement_price(pricing: Optional[PricingObject], tier: str, table_choice: str) -> Optional[int]:
    """What one seat costs for its day: its tier's price, or the half-table share of it."""
    full = tier_price(pricing, tier)
    if full is None or not is_half(table_choice):
        return full
    return half_price(full, pricing.half_table_percent)


def row_prices(pricing: Optional[PricingObject], row: MarketTableRow) -> List[Dict[str, Any]]:
    """Each occupant of one table-day with what their seat costs, none where it is unpriced.

    A full table lists its vendor once, though they fill both seats.
    """
    occupants = list(dict.fromkeys(email for email in row.assignment if email))
    cents = placement_price(pricing, row.tier, row.table_choice)
    if cents is None:
        return []
    return [{"email": email, "cents": cents} for email in occupants]


def pricing_refusal(plan: SetupObject) -> Optional[str]:
    """Why a plan's prices cannot be saved, or None: each price names one tier of the plan, once."""
    if plan.pricing is None:
        return None
    tiers = {tier.name for tier in plan.tiers}
    seen = set()
    for price in plan.pricing.everyone_else:
        if price.tier not in tiers:
            return f"The pricing names a tier the plan does not have: {price.tier!r}."
        if price.tier in seen:
            return f"The pricing gives the tier {price.tier!r} two prices."
        seen.add(price.tier)
    return None


def pricing_fields(plan: Optional[SetupObject]) -> Dict[str, Any]:
    """The card's fields in one comparable shape, all None on a market never priced: what the
    history's ``pricing`` entry records before and after."""
    pricing = plan.pricing if plan else None
    if pricing is None:
        return {"currency": None, "half_table_percent": None, "everyone_else": None}
    return pricing.model_dump()
