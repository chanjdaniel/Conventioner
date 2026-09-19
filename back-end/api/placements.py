"""The single writer of a market's assignment.

``assignmentObject.vendorAssignments`` is what check-in reads at the door, so anything that
writes it decides where a vendor stands on the day. Until E11 there was no writer at all: the
organizer's browser fetched a computed assignment from ``GET /markets/<id>/assignment`` and PUT
the whole market back, which meant *any* market PUT carrying a stale client copy could overwrite
an assignment wholesale - with no manual editing involved. ``_preserve_server_owned_fields`` now
takes ``assignment_object`` from the stored market like every other server-owned field, and the
two functions here are what may change it:

- ``run_assignment`` runs the solver and stores the result, replacing the browser's fetch-then-PUT.
- ``write_placement`` writes one vendor into one seat on one date.

Both are gated on ``MarketRole.EDITOR``, the same bar as every other market write and deliberately
not stricter: an EDITOR can already rewrite the tiers, sections and table counts the whole
assignment is computed from, so withholding "move one vendor between two seats" protects nothing.
"""

from typing import Any, Dict, List, Optional, Tuple

from assignment.assignment import (
    NOTHING_TO_ASSIGN,
    IncompleteApplicationsError,
    assign_market,
    solver_vendors_for,
)
from assignment.utils import convert_keys_to_camel_case
from datatypes import (
    Market,
    MarketRole,
    SectionObject,
    SetupObject,
    VendorAssignmentResult,
    table_code_for,
)
import api.markets as MarketsApi

# The three seats a table holds. A table holds two, and a placement therefore always names a
# side: "the vendor at Front Row 1" is not an address anyone can stand at.
FULL_TABLE = "Full Table"
HALF_TABLE_LEFT = "Half Table (Left)"
HALF_TABLE_RIGHT = "Half Table (Right)"
TABLE_CHOICES = (FULL_TABLE, HALF_TABLE_LEFT, HALF_TABLE_RIGHT)


class PlacementError(ValueError):
    """The requested placement does not describe a seat this market has. Callers map this to 400.

    A dedicated type rather than a bare ``ValueError``: anything else escaping a placement write
    is a bug, and reporting a bug to the client as a bad request hides it.
    """


def _seat_section(setup_object: SetupObject, table_code: str) -> Optional[SectionObject]:
    """The section a table code belongs to, or None when the plan holds no such table.

    Derived from the plan rather than taken from the request, so a placement can never name a
    tier the organizer did not give that table - tier sets the price.
    """
    for section in setup_object.sections:
        for index in range(section.count):
            if table_code_for(section.name, index + 1) == table_code:
                return section
    return None


def _placement_for(
    market: Market, email: str, date: str, table_code: str, table_choice: str
) -> VendorAssignmentResult:
    """Build the row a placement writes, validating it against the market's own plan."""
    setup_object = market.setup_object
    if setup_object is None:
        raise PlacementError("Market has no plan, so it has no tables to place anyone at.")

    if not email:
        raise PlacementError("A placement must name the vendor it places.")

    if date not in {market_date.date for market_date in setup_object.market_dates}:
        raise PlacementError(f"{date!r} is not one of this market's dates.")

    section = _seat_section(setup_object, table_code)
    if section is None:
        raise PlacementError(f"This market's plan has no table {table_code!r}.")

    if table_choice not in TABLE_CHOICES:
        raise PlacementError(
            f"{table_choice!r} is not a seat. Expected one of: {', '.join(TABLE_CHOICES)}."
        )

    return VendorAssignmentResult(
        email=email,
        date=date,
        table_code=table_code,
        table_choice=table_choice,
        section=section.name,
        tier=section.tier.name if section.tier else "",
        location=section.location.name if section.location else "",
    )


def _store_vendor_assignments(
    market_id: str, vendor_assignments: List[VendorAssignmentResult], assignment_date: str
) -> None:
    """Write the placements, and nothing else, onto the stored market.

    Statistics are never persisted - every read derives them fresh - so only the two fields that
    are the assignment itself are set. A ``$set`` of the two keys rather than of the whole
    ``assignmentObject`` keeps a stale ``assignmentStatistics`` from being resurrected by a write.
    """
    MarketsApi.markets_collection.update_one(
        {"id": market_id},
        {
            "$set": {
                "assignmentObject.vendorAssignments": [
                    convert_keys_to_camel_case(placement.model_dump())
                    for placement in vendor_assignments
                ],
                "assignmentObject.assignmentDate": assignment_date,
                "assignmentObject.assignmentStatistics": None,
            }
        },
    )


def run_assignment(market_id: str, requesting_user: str) -> Tuple[Dict[str, Any], int]:
    """Run the solver over this market's approved applications and store what it produced.

    This is the write half of what ``GET /markets/<id>/assignment`` computes. The organizer's
    browser used to do both, by PUTting the market back with the assignment it had just been
    handed; with ``assignment_object`` server-owned that round-trip no longer stores anything,
    and it should never have been the client's job to decide what the solver said.
    """
    market = MarketsApi._load_market_for(market_id, requesting_user, MarketRole.EDITOR, "edit")

    if market.setup_object is None:
        return {"error": "Market has no setup configured"}, 400

    try:
        vendors = solver_vendors_for(market)
    except IncompleteApplicationsError as incomplete:
        # The organizer has to go and fix something, so say who.
        return {"error": incomplete.message()}, 400

    # Refused here for the same reason ``get_assigned_market`` refuses it: a run over nobody
    # produces a screen indistinguishable from a run that failed.
    if not vendors:
        return {"error": NOTHING_TO_ASSIGN}, 400

    market.assignment_object.assignment_statistics = None
    assigned_market = assign_market(market, vendors)
    assignment = assigned_market.assignment_object

    _store_vendor_assignments(
        market_id, assignment.vendor_assignments, assignment.assignment_date
    )

    # The same shape ``GET /markets/<id>/assignment`` returns, so a caller swapping to this one
    # reads the result the same way - the organization's display name included, because the
    # browser replaces the market it is holding with this response and the summary card reads it.
    payload = convert_keys_to_camel_case(assigned_market.model_dump())
    _organization, organization_dict = MarketsApi._load_organization_context(
        market.organization_id
    )
    if organization_dict:
        payload["organizationName"] = organization_dict.get("name")
    return payload, 200


def write_placement(
    market_id: str, placement_data: Dict[str, Any], requesting_user: str
) -> Tuple[Dict[str, Any], int]:
    """Place one vendor in one seat on one date, replacing whatever they held that date.

    A vendor holds at most one seat per date, so a second placement on the same date moves them
    rather than giving them two. Whoever already sits in the target seat is left alone here: a
    seat contradiction is refused at pin time (E11/F02/S02), and trading two vendors is an
    operation of its own (E11/F03/S01), because a write that quietly displaces an occupant is
    how a vendor is silently unassigned on market day.
    """
    market = MarketsApi._load_market_for(market_id, requesting_user, MarketRole.EDITOR, "edit")

    placement = _placement_for(
        market,
        email=str(placement_data.get("email") or "").strip(),
        date=str(placement_data.get("date") or "").strip(),
        table_code=str(placement_data.get("table_code") or "").strip(),
        table_choice=str(placement_data.get("table_choice") or "").strip(),
    )

    kept = [
        existing
        for existing in market.assignment_object.vendor_assignments
        if not (existing.email == placement.email and existing.date == placement.date)
    ]
    kept.append(placement)

    _store_vendor_assignments(market_id, kept, market.assignment_object.assignment_date)

    return {"placement": convert_keys_to_camel_case(placement.model_dump())}, 200
