"""What an assignment costs, read from the market's Pricing card (E43/F01/S01, S02).

A price is for one table on one market day (Daniel, Q4), and it follows the table (Q20): the
table's tier, and whether the vendor has the whole table or half of it, even at a tier the vendor
did not pick. Two vendors sharing a table each pay a half table. Prices are whole cents in the
market's one currency; a market with no prices, or a tier the card leaves empty, prices nothing.

Which row of the card a vendor pays is read from their own answers (Q5): the card's groups are the
organizer's, each a rule over the market's own choice questions, and a vendor pays the cheapest
group they match at the table's tier (Q6), or "Everyone else" where they match none. No question of
any one market's form is named here (Q14).
"""
from typing import Any, Dict, Iterable, List, NamedTuple, Optional

import api.applications as ApplicationsApi
import essential_fields as EssentialFields
from datatypes import (
    FORM_FIELD_KEY_PATTERN, PRICING_CURRENCIES, FormField, Market, MarketTableRow, PriceGroup,
    PricingObject, SetupObject, TierPrice,
)
from rejection_rules import Rulebook

CURRENCIES = PRICING_CURRENCIES

#: The card's fixed last row, for a vendor in no group; no group may take its name.
EVERYONE_ELSE = "Everyone else"

#: Each currency's sign as the screen writes it (``Intl.NumberFormat`` in en-CA, ``formatPrice``
#: in ``front-end/src/utils/pricing.ts``), so an amount reads the same in a file as on screen.
CURRENCY_SIGNS = {"CAD": "$", "USD": "US$", "EUR": "€", "GBP": "£", "AUD": "A$", "NZD": "NZ$"}

#: The currency an amount is written in where the market names none: the card's own default.
DEFAULT_CURRENCY = "CAD"


def money_text(cents: int, currency: Optional[str]) -> str:
    """An amount as the Payment tab writes it: "$35", "$15.01" where there are cents,
    "$1,234,567.50", and "-$15" below zero (``money`` in ``front-end/src/utils/payments.ts``)."""
    sign = CURRENCY_SIGNS[currency or DEFAULT_CURRENCY]
    whole, part = divmod(abs(cents), 100)
    amount = f"{whole:,}" + (f".{part:02d}" if part else "")
    return f"{'-' if cents < 0 else ''}{sign}{amount}"


def half_price(cents: int, percent: int) -> int:
    """``percent`` of ``cents``, rounded half up to the cent: 50% of $30.01 is $15.01.

    Integer arithmetic, so no float ever decides a cent.
    """
    return (cents * percent + 50) // 100


def is_half(table_choice: str) -> bool:
    """Whether an assignment is half a table: "Half Table", or a side of one."""
    return "half" in (table_choice or "").lower()


def _at(prices: List[TierPrice], tier: str) -> Optional[int]:
    return next((price.cents for price in prices if price.tier == tier), None)


def tier_price(pricing: Optional[PricingObject], tier: str) -> Optional[int]:
    """"Everyone else"'s price for a full table at ``tier``, or None where the card gives none."""
    if pricing is None:
        return None
    return _at(pricing.everyone_else, tier)


def _share(pricing: PricingObject, full: int, table_choice: str) -> int:
    return half_price(full, pricing.half_table_percent) if is_half(table_choice) else full


def assignment_price(pricing: Optional[PricingObject], tier: str, table_choice: str) -> Optional[int]:
    """What one assignment costs a vendor in no group for its day: "Everyone else"'s price at its
    tier, or the half-table share of it."""
    full = tier_price(pricing, tier)
    return None if full is None else _share(pricing, full, table_choice)


class Price(NamedTuple):
    """What one assignment costs, and the row of the card that set it: a group's name, "Everyone
    else" on a card with groups, or None on a card that has only that row."""
    cents: int
    group: Optional[str]


class Groups:
    """A market's price groups as they stand against its current form (E43/F01/S02).

    A group holds a vendor when it has a condition and every condition holds of their answers,
    judged as the automatic rejections judge a rule (``Rulebook.met``). A condition with no answer
    ticked, or a group with none, holds nobody yet; so does a broken condition, one on a question
    the form no longer asks as a choice or on an answer it no longer offers - kept on the card, shown
    there as broken, and keeping the market in draft until it is fixed (``broken``).
    """

    def __init__(self, market: Market):
        self.pricing = market.setup_object.pricing if market.setup_object else None
        self.list: List[PriceGroup] = self.pricing.groups if self.pricing else []
        self.book = Rulebook(market)
        self.form_fields = sorted(
            market.application_form.fields if market.application_form else [],
            key=lambda field: field.order)

    def keys(self) -> List[str]:
        """The questions the groups read, once each: only whole conditions', whose keys are the
        form's own, so a key the form never had never reaches the answers' projection."""
        return list(dict.fromkeys(c.key for group in self.list for c in group.conditions
                                  if not self.book.broken(c)))

    def fields(self) -> List[FormField]:
        """The form's own questions the groups read, in the form's order: what a vendor added by
        hand is asked, so they are priced like any other (E43/F01/S03). An essential choice a group
        may read, the table choice or the dates, is the assignment's, and is not among them."""
        read = set(self.keys())
        return [field for field in self.form_fields if field.key in read
                and not field.key.startswith(EssentialFields.ESSENTIAL_KEY_PREFIX)]

    def broken(self) -> List[str]:
        """The names of the groups with a broken condition, in the card's order."""
        return [group.name for group in self.list
                if any(self.book.broken(condition) for condition in group.conditions)]

    def _holds(self, group: PriceGroup, answers: Dict[str, Any]) -> bool:
        return bool(group.conditions) and all(
            not self.book.broken(condition) and self.book.met(condition, answers)
            for condition in group.conditions)

    def price(self, answers: Dict[str, Any], tier: str, table_choice: str) -> Optional[Price]:
        """What a vendor with these answers pays for one table at ``tier``: the cheapest group they
        are in that prices the tier, the first on the card of two alike; else "Everyone else"'s
        price there; None where neither prices it."""
        if self.pricing is None:
            return None
        priced = [(cents, group.name) for group in self.list
                  if (cents := _at(group.prices, tier)) is not None and self._holds(group, answers)]
        if priced:
            cents, name = min(priced, key=lambda candidate: candidate[0])
            return Price(_share(self.pricing, cents, table_choice), name)
        full = tier_price(self.pricing, tier)
        if full is None:
            return None
        return Price(_share(self.pricing, full, table_choice),
                     EVERYONE_ELSE if self.list else None)


def vendor_answers(groups: Groups, market_id: str) -> Dict[str, Dict[str, Any]]:
    """Each vendor's answers to the questions the groups read, as the organizer reads them (an
    update in place of the vendor's answer, E41/F01/S01), keyed by lowercased address; none read
    on a card with no group."""
    keys = groups.keys()
    return ApplicationsApi.vendor_answers_for_market(market_id, keys) if keys else {}


def row_prices(
    groups: Groups, row: MarketTableRow, answers: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Each vendor at one table-day with what their assignment costs and the card's row that set
    it, none where it is unpriced. ``answers`` is ``vendor_answers``; a vendor with none there, one
    placed with no application, pays "Everyone else".

    A full table lists its vendor once, though they fill both halves.
    """
    occupants: Iterable[str] = dict.fromkeys(email for email in row.assignment if email)
    prices = []
    for email in occupants:
        price = groups.price(answers.get(email.strip().lower(), {}), row.tier, row.table_choice)
        if price is not None:
            prices.append({"email": email, "cents": price.cents, "group": price.group})
    return prices


def _prices_refusal(prices: List[TierPrice], tiers: set, row: str) -> Optional[str]:
    seen = set()
    for price in prices:
        if price.tier not in tiers:
            return f"{row} names a tier the plan does not have: {price.tier!r}."
        if price.tier in seen:
            return f"{row} gives the tier {price.tier!r} two prices."
        seen.add(price.tier)
    return None


def pricing_refusal(plan: SetupObject) -> Optional[str]:
    """Why a plan's prices cannot be saved, or None: each row's prices name tiers of the plan, once
    each; each group has a name of its own, not the last row's; and each condition names a
    question, once in its group, by a key a form's question could have.

    A condition is not judged against the form here: one the form has since lost is kept and shown
    broken (``Groups.broken``), so a form change never makes the plan unsavable.
    """
    if plan.pricing is None:
        return None
    tiers = {tier.name for tier in plan.tiers}
    refused = _prices_refusal(plan.pricing.everyone_else, tiers, "The pricing")
    if refused:
        return refused
    names = {EVERYONE_ELSE.casefold()}
    for group in plan.pricing.groups:
        name = group.name.strip()
        if not name:
            return "Every price group needs a name."
        if name.casefold() in names:
            if name.casefold() == EVERYONE_ELSE.casefold():
                return f"A price group cannot be called {EVERYONE_ELSE!r}: that is the last row."
            return f"The pricing has two groups called {name!r}."
        names.add(name.casefold())
        keys = set()
        for condition in group.conditions:
            if not FORM_FIELD_KEY_PATTERN.match(condition.key):
                # The key reaches a Mongo projection of the answers; only a form's own slug may.
                return f"A condition of the price group {name!r} names no question of a form."
            if condition.key in keys:
                return (f"The price group {name!r} has two conditions on one question; one names "
                        "every answer that meets it.")
            keys.add(condition.key)
        refused = _prices_refusal(group.prices, tiers, f"The price group {name!r}")
        if refused:
            return refused
    return None


def pricing_fields(plan: Optional[SetupObject]) -> Dict[str, Any]:
    """The card's fields in one comparable shape: what the history's ``pricing`` entry records
    before and after. A market never priced is the card as it starts (Canadian dollars, half off,
    no group, no price), so its first price records the prices typed and nothing the organizer
    did not touch."""
    pricing = plan.pricing if plan and plan.pricing else PricingObject()
    return pricing.model_dump()


def pricing_subject(plan: Optional[SetupObject]) -> Dict[str, Any]:
    """What a ``pricing`` entry is about beside its fields: the currency its prices are in, which
    its detail names only when the currency itself changed."""
    return {"currency": pricing_fields(plan)["currency"]}
