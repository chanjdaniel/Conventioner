"""Why a vendor has no table on a market date.

The payoff screen listed unassigned vendors by email under a heading and said nothing else. A walk
produced five approved applications, three placed, **nineteen of twenty-four table-slots free** and
two vendors unplaced, with no explanation of the contradiction anywhere on screen - because both
had asked for a tier the market has no sections at.

Resolved by readable-journey ticket 04, whose one idea is here: **the reason is computed on read,
never recorded during the run.**

A recorded reason goes stale the moment the plan changes or a manual placement lands, and it cannot
say the most useful thing of all - *this vendor could be placed right now* - because at the moment
the solver gave up, they could not. A computed one is always true of the current state.

Nothing in this module runs the solver, and nothing in the solver calls it. It reads what a vendor
asked for (a ``SolverVendor``, the one seam where application shape meets solver shape), what the
plan offers, and what has actually been placed - all three as they stand.
"""
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from datatypes import SetupObject, table_code_for
from essential_fields import TABLE_CHOICE_FULL, TABLE_CHOICE_HALF
from assignment.vendor_input import SolverVendor


class PlacementReason(str, Enum):
    """Why there is no table for one vendor on one date.

    An enum, not a sentence: the wording belongs to whichever surface is showing it, and must be
    changeable without a migration or a back-end release.
    """

    #: They did not tick that date.
    NOT_AVAILABLE = "not_available"
    #: The plan has no section at any tier they named, so there is no table for them on any date.
    NO_TABLE_AT_THEIR_TIER = "no_table_at_their_tier"
    #: Tables they would accept exist on that date, and every one is occupied.
    TAKEN = "taken"
    #: Tables they would accept exist on that date and one is open - they could be placed now.
    FREE = "free"


@dataclass(frozen=True)
class UnplacedDate:
    """One vendor, one date they hold no table on, and why."""

    email: str
    date: str
    reason: PlacementReason


def _placement_key(placement: Any, field: str) -> str:
    """One field of a placement, whichever shape the caller had it in."""
    if isinstance(placement, dict):
        return str(placement.get(field) or "")
    return str(getattr(placement, field, "") or "")


def _placement_flag(placement: Any, field: str) -> bool:
    """One boolean field of a placement, whichever shape the caller had it in."""
    if isinstance(placement, dict):
        return bool(placement.get(field))
    return bool(getattr(placement, field, False))


def _occupies_whole_table(table_choice: str) -> bool:
    """Does this placement leave room beside it?

    A table holds one full-table vendor or two halves, so only a half leaves a seat. The stored
    spelling is the assignment's own ("Full Table", "Half Table (Left)"), not the applicant's code.
    """
    return "half" not in table_choice.strip().lower()


def _wants_a_whole_table(vendor: SolverVendor) -> bool:
    """A vendor who asked for a whole table cannot take the seat beside someone."""
    return vendor.table_choice == TABLE_CHOICE_FULL


def unplaced_dates(
    setup_object: Optional[SetupObject],
    vendors: Iterable[SolverVendor],
    placements: Sequence[Any],
) -> List[UnplacedDate]:
    """Every (vendor, date) with no table, each with the reason it has none.

    ``placements`` is the assignment as it stands - the solver's output, or whatever it has been
    edited to since. Pass it in rather than reading it from anywhere, because that is what makes
    the answer true of the current state: unplacing somebody by hand flips their neighbours'
    reason from TAKEN to FREE with nothing re-run.

    Partially placed vendors are covered, not only those with no placements at all: a vendor who
    asked for two dates and got one has a gap, and the product used to render it as an em dash.
    """
    if setup_object is None:
        return []

    dates = [market_date.date for market_date in setup_object.market_dates]
    sections = list(setup_object.sections)

    placed: Set[Tuple[str, str]] = set()
    # (date, table_code) -> the table choices placed there, so "is there room" is a lookup.
    occupancy: Dict[Tuple[str, str], List[str]] = {}
    for placement in placements:
        email = _placement_key(placement, "email").strip().lower()
        date = _placement_key(placement, "date")
        if email and date:
            placed.add((email, date))
        table_code = _placement_key(placement, "table_code")
        if date and table_code:
            occupancy.setdefault((date, table_code), []).append(
                _placement_key(placement, "table_choice")
            )

    unplaced: List[UnplacedDate] = []
    for vendor in vendors:
        email = (vendor.email or "").strip().lower()
        for date in dates:
            if (email, date) in placed:
                continue
            unplaced.append(
                UnplacedDate(
                    email=email,
                    date=date,
                    reason=_reason_for(vendor, date, sections, occupancy),
                )
            )
    return unplaced


def _reason_for(
    vendor: SolverVendor,
    date: str,
    sections: Sequence[Any],
    occupancy: Dict[Tuple[str, str], List[str]],
) -> PlacementReason:
    """Why this vendor holds no table on this date.

    The order is the order an organizer would ask it in: did they even want this day, is there
    anything here they would accept, and if so has someone else taken it.
    """
    if date not in vendor.available_dates:
        return PlacementReason.NOT_AVAILABLE

    # A section with no tables is no tables. Counting it as acceptable would answer "every table
    # they accept is taken" for a market that has none to take.
    acceptable = [
        section for section in sections
        if section.count > 0
        and vendor.accepts_tier_on(date, section.tier.name if section.tier else None)
    ]
    if not acceptable:
        return PlacementReason.NO_TABLE_AT_THEIR_TIER

    wants_whole = _wants_a_whole_table(vendor)
    for section in acceptable:
        for index in range(1, section.count + 1):
            occupants = occupancy.get((date, table_code_for(section.name, index)), [])
            if not occupants:
                return PlacementReason.FREE
            if wants_whole:
                continue
            # One half-table occupant leaves the other half, which this vendor would take.
            if len(occupants) == 1 and not _occupies_whole_table(occupants[0]):
                return PlacementReason.FREE
    return PlacementReason.TAKEN


class PlacementOverride(str, Enum):
    """What one hand placement overrides about the vendor's own answer.

    A pin that breaks a filter stands - a sponsor, a late deal, an accessibility need, and
    admins edit without restriction - but it must never stand *silently*. Tier sets the price,
    so someone will be charged for a table they did not choose.

    Computed on read, like every reason in this module, because it is a comparison between two
    things that both change: what the applicant answered, and where they were put.
    """

    #: Seated at a tier they did not accept on that date. This is the one that costs money.
    TIER = "tier"
    #: Seated on a date they did not say they were available for.
    DATE = "date"
    #: Given a whole table when they asked to share, or half a table when they asked for a whole
    #: one. Their answer is not rewritten to match; the placement simply differs from it.
    TABLE_CHOICE = "table_choice"


@dataclass(frozen=True)
class OverriddenPlacement:
    """One hand placement, and every way it contradicts what the vendor asked for."""

    email: str
    date: str
    table_code: str
    overrides: Tuple[PlacementOverride, ...]


def _overrides_of(vendor: SolverVendor, placement: Any) -> Tuple[PlacementOverride, ...]:
    date = _placement_key(placement, "date")
    found: List[PlacementOverride] = []

    offered_the_date = date in vendor.available_dates
    if not offered_the_date:
        found.append(PlacementOverride.DATE)

    # Tier is answered per date, so a date they never offered carries no tier answer to
    # contradict. Reporting one there would put a price warning on every out-of-date placement,
    # and the thing to tell the organizer about that placement is the date.
    tier = _placement_key(placement, "tier")
    if offered_the_date and tier and not vendor.accepts_tier_on(date, tier):
        found.append(PlacementOverride.TIER)

    seated_whole = _occupies_whole_table(_placement_key(placement, "table_choice"))
    if vendor.table_choice == TABLE_CHOICE_FULL and not seated_whole:
        found.append(PlacementOverride.TABLE_CHOICE)
    elif vendor.table_choice == TABLE_CHOICE_HALF and seated_whole:
        found.append(PlacementOverride.TABLE_CHOICE)

    return tuple(found)


def overridden_placements(
    vendors: Iterable[SolverVendor], placements: Sequence[Any],
) -> List[OverriddenPlacement]:
    """Every hand placement that contradicts the vendor's own answer.

    Only hand placements: the solver never contradicts an answer, so a solver row that appeared
    here would be a bug in the solver rather than a decision anyone made. A pin for a vendor this
    market no longer has is not reported - there is no answer left to contradict, and that pin is
    an orphan, which ``orphaned_pins`` below is about.
    """
    by_email = {(vendor.email or "").strip().lower(): vendor for vendor in vendors}

    overridden: List[OverriddenPlacement] = []
    for placement in placements:
        if not _placement_flag(placement, "hand_placed"):
            continue
        vendor = by_email.get(_placement_key(placement, "email").strip().lower())
        if vendor is None:
            continue
        overrides = _overrides_of(vendor, placement)
        if overrides:
            overridden.append(
                OverriddenPlacement(
                    email=_placement_key(placement, "email").strip().lower(),
                    date=_placement_key(placement, "date"),
                    table_code=_placement_key(placement, "table_code"),
                    overrides=overrides,
                )
            )
    return overridden


def orphaned_pins(
    setup_object: Optional[SetupObject], placements: Sequence[Any],
) -> List[Any]:
    """Every hand placement whose seat the plan no longer has.

    Deleting the section a pinned seat belongs to, or dropping that section's table count below
    it, leaves the pin in place: silent deletion loses a deliberate guarantee without telling
    anyone, and refusing the plan edit would make pins a lock on the floor plan an organizer
    should be free to rearrange. The reckoning is deferred to the next assignment, which is the
    moment they were going to look anyway.

    The seat, not the vendor: a pin for someone who has withdrawn is a different problem, and
    reporting it as a plan problem would send the organizer to the plan editor to fix something
    that is not wrong there.
    """
    if setup_object is None:
        return [p for p in placements if _placement_flag(p, "hand_placed")]

    dates = {market_date.date for market_date in setup_object.market_dates}
    seats = {
        table_code_for(section.name, index)
        for section in setup_object.sections
        for index in range(1, section.count + 1)
    }

    return [
        placement for placement in placements
        if _placement_flag(placement, "hand_placed")
        and (
            _placement_key(placement, "date") not in dates
            or _placement_key(placement, "table_code") not in seats
        )
    ]
