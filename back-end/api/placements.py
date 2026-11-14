"""The routes that change a market's assignment.

``assignmentObject.vendorAssignments`` is what check-in reads at the door, so anything that
writes it decides where a vendor stands on the day. Until E11 there was no writer at all: the
organizer's browser fetched a computed assignment from ``GET /markets/<id>/assignment`` and PUT
the whole market back, which meant *any* market PUT carrying a stale client copy could overwrite
an assignment wholesale - with no manual editing involved. That PUT is gone (E21/F03/S06), and the
functions here are the only things that may change it, each writing through the assignment's
lifecycle (``assignment/lifecycle.py``, T316), which stores the assignment's state beside its rows:

- ``run_assignment`` runs the solver and stores the result, replacing the browser's fetch-then-PUT.
- ``write_placement`` writes one vendor into one seat on one date.
- ``remove_placement`` frees one vendor's seat on one date, and ``swap_placements`` trades two.

Each of the three by hand asks first when it would free, move or swap a vendor who has checked in
that day (``VendorIsHere``, T318), and goes ahead when asked again with ``whileHere: true``.

Each asks the table's Assignment row (``Actions.ASSIGN``, E39/F01/S01), whose default is EDITOR, the
same bar as every other market write and deliberately not stricter: an EDITOR can already rewrite
the tiers, sections and table counts the whole assignment is computed from, so withholding "move
one vendor between two seats" protects nothing.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from assignment.assignment import (
    NOTHING_TO_ASSIGN,
    IncompleteApplicationsError,
    assign_market,
    solver_vendors_for,
)
from assignment.utils import convert_keys_to_camel_case
from datatypes import (
    FULL_TABLE,
    TABLE_CHOICES,
    Market,
    MarketPhase,
    SectionObject,
    SetupObject,
    VendorAssignmentResult,
    table_code_for,
)
import api.applications as ApplicationsApi
import api.attendance as AttendanceApi
import api.market_actions as Actions
import api.markets as MarketsApi
import api.payments as PaymentsApi
import assignment.lifecycle as Lifecycle
import assignment.made_from as MadeFrom
from client_errors import BadRequestError, ConflictError, ForbiddenError
import essential_fields as EssentialFields
import history as History
from market_write import MarketChanged
from tombstone import live
from utils.email_address import normalized_email


class PlacementError(BadRequestError):
    """The requested placement does not describe a seat this market has. A 400.

    A dedicated type rather than a bare ``ValueError``: anything else escaping a placement write
    is a bug, and reporting a bug to the client as a bad request hides it.
    """


class AssignPhaseError(ConflictError):
    """The assignment may not be run in this market's phase. A 409.

    A conflict with the market's state rather than a malformed request: the same call is correct
    one transition earlier or later.
    """


class SeatTakenError(PlacementError):
    """Someone else already holds the seat. A 409.

    Separate from its parent because it is a conflict rather than a malformed request: the
    placement describes a real seat, and would have been written a moment earlier.
    """

    status = 409


#: The ``code`` of the 409 a free, a move or a swap of a vendor who is here answers, which the
#: placement dialog tells apart from a seat taken meanwhile (``isVendorHere``).
VENDOR_IS_HERE = "vendor_is_here"


class VendorIsHere(ConflictError):
    """The change would free, move or swap a vendor who has checked in that day. A 409 that wrote
    nothing, coded ``vendor_is_here``: the same request with ``whileHere: true`` goes ahead (T318).

    A conflict with who is at the door, not with the market: nothing changed since the page read it,
    so the screen asks and resends rather than reading the tables again. Asked by the server, not
    only the screen, so a second organizer whose roster had not caught up is asked too.
    """

    def body(self) -> Dict[str, Any]:
        return {"error": self.message, "code": VENDOR_IS_HERE}


def _vendor_said(market_id: str, email: str) -> str:
    """A vendor as a sentence names them: the name they chose, or the one on their identification,
    or their address when the application gave neither."""
    application = ApplicationsApi.find_application_by_email(market_id, email)
    return EssentialFields.display_name((application or {}).get("form_data") or {}) or email


def _ask_first_if_here(
    market: Market, date: str, seats: List[VendorAssignmentResult], while_here: bool,
) -> bool:
    """Refuse with ``VendorIsHere`` when any vendor of ``seats`` has checked in on ``date``, unless
    the request says ``while_here``; answer whether any had, which the history entry then says.

    The sentence names each by the table their check-in was made at, and a record from before
    check-ins kept a table (T318) as made at the seat held now, as the roster reads it. The check-in
    is left where it was made: it records an arrival, and the roster shows where they stand.
    """
    here = []
    for seat in seats:
        record = AttendanceApi.checked_in_on(market.id, seat.email, date)
        if record is not None:
            here.append((_vendor_said(market.id, seat.email),
                         record.get("table_code") or seat.table_code))
    if here and not while_here:
        day = _said_day(date)
        if len(here) == 1:
            [(name, table)] = here
            raise VendorIsHere(f"{name} checked in at table {table} for {day}. "
                               "Their check-in stays recorded there.")
        (first, first_table), (second, second_table) = here
        raise VendorIsHere(f"{first} checked in at table {first_table} and {second} at table "
                           f"{second_table} for {day}. Their check-ins stay recorded there.")
    return bool(here)


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


def _seat_taken_by(
    market: Market, placement: VendorAssignmentResult
) -> Optional[VendorAssignmentResult]:
    """Who already holds the seat this placement names, if anyone.

    A whole table needs both seats, so any occupant is in the way; a half needs the side it
    names, and the other side is somebody else's business. The vendor's own row does not count:
    a placement replaces whatever they held on that date.
    """
    wants_whole_table = placement.table_choice == FULL_TABLE
    for existing in market.assignment_object.vendor_assignments:
        if existing.email == placement.email:
            continue
        if existing.date != placement.date or existing.table_code != placement.table_code:
            continue
        if (
            wants_whole_table
            or existing.table_choice == FULL_TABLE
            or existing.table_choice == placement.table_choice
        ):
            return existing
    return None


def has_applied(market_id: str, address: str) -> bool:
    """Whether the market holds an application from this address, the one way into a seat."""
    return ApplicationsApi.find_application_by_email(market_id, address) is not None


def _applicant_address(market: Market, email: str) -> str:
    """The address a seat is written under: the applicant's, as stored, or a refusal (E36/F02/S01).

    A seat goes only to someone the market has an application for. A typed address used to take
    one with no name, no answers and nothing in the vendor drawer; a vendor who never applied is
    added as one first, and then has all three.
    """
    address = normalized_email(email)
    if not address:
        raise PlacementError("An assignment must name the vendor it assigns.")
    if not has_applied(market.id, address):
        raise PlacementError(
            f"{address} has no application in this market, so they cannot be given a seat. "
            "Add them as a vendor first."
        )
    return address


def _placement_for(
    market: Market, email: str, date: str, table_code: str, table_choice: str
) -> VendorAssignmentResult:
    """Build the row a placement writes, validating it against the market's own plan."""
    setup_object = market.setup_object
    if setup_object is None:
        raise PlacementError("Market has no plan, so it has no tables to assign anyone to.")

    email = _applicant_address(market, email)

    if date not in {market_date.date for market_date in setup_object.market_dates}:
        raise PlacementError(f"{date!r} is not one of this market's dates.")

    section = _seat_section(setup_object, table_code)
    if section is None:
        raise PlacementError(f"This market's plan has no table {table_code!r}.")

    if table_choice not in TABLE_CHOICES:
        raise PlacementError(
            f"{table_choice!r} is not a seat. Expected one of: {', '.join(TABLE_CHOICES)}."
        )

    # Flagged hand-placed, which is what makes it a pin: the solver treats a flagged row as
    # fixed and places everyone else around it (E11/F02/S01). There is no separate constraint
    # object to write - pinning before any solver run is just writing this row early.
    return VendorAssignmentResult(
        email=email,
        date=date,
        table_code=table_code,
        table_choice=table_choice,
        section=section.name,
        tier=section.tier.name if section.tier else "",
        location=section.location.name if section.location else "",
        hand_placed=True,
    )


# The one phase the assignment runs in, and the whole of what this rule says (E10/F03/S02).
#
# It deliberately does not repeat the rules around it: `assignment` carries the entry invariant
# `_ALL_REVIEWED`, so "review everyone first" is already said once in ``guards.py``, and
# `market_days` carries `_ASSIGNMENT_COMPUTED`, so "run it before publishing" is said there too.
# Repeating either here would give the product two places to change when one of them moves.
#
# Server-side and not only in the UI, because the endpoint is reachable directly and a hidden
# button is not a rule. Re-running INSIDE `assignment` stays allowed: an organizer who changes the
# plan or approves a late application needs a fresh answer, and there is nothing to protect yet.
ASSIGN_PHASE = MarketPhase.ASSIGNMENT


def assign_phase_refusal(phase: MarketPhase) -> Optional[str]:
    """Why the assignment cannot be run in this phase, or None.

    Served through ``assign_refusal`` as ``assignRefusalReason``, which the screens read rather
    than keep a copy of (T316), so the button says no before it is pressed. Each message names an
    action available from the phase the organizer is actually in.
    """
    if phase is ASSIGN_PHASE:
        return None
    if phase is MarketPhase.DRAFT:
        return (
            "This market is still a draft. Plan it, take its applications in and review them - "
            "tables are allocated once the market reaches the assignment phase."
        )
    if phase is MarketPhase.APPLICATIONS:
        return (
            "This market's applications are still being reviewed. Decide every one, then move the "
            "market to the assignment phase to allocate tables."
        )
    if phase is MarketPhase.ARCHIVED:
        return MarketsApi.ARCHIVED_REFUSAL
    # Past assignment, the answer is settled and the vendors have been told. Changing one
    # placement is what is wanted here, and the Assignments page is where that happens (E11/F03,
    # E22/F04/S04).
    return (
        "The table allocation for this market is settled. Change a single assignment on the "
        "Assignments page instead of allocating tables again."
    )


RESULTS_PUBLISHED_REFUSAL = (
    "Results are published, so the table allocation is settled: applicants have been told whether "
    "they have a table, and allocating again could move them. Change a single assignment on the "
    "Assignments page instead."
)


def assign_refusal(market: Market) -> Optional[str]:
    """Why this market's assignment cannot be run now, or None (E36/F04/S02): its phase, or its
    published results, as the lifecycle owner reads them (T316). Served as
    ``assignRefusalReason``, so the Assign button says no first."""
    return assign_phase_refusal(market.phase) or (
        RESULTS_PUBLISHED_REFUSAL if Lifecycle.results_published(market) else None
    )


def run_assignment(market_id: str, requesting_user: str) -> Tuple[Dict[str, Any], int]:
    """Run the solver over this market's approved applications and store what it produced.

    This is the write half of what ``GET /markets/<id>/assignment`` computes. The organizer's
    browser used to do both, by PUTting the market back with the assignment it had just been
    handed; with ``assignment_object`` server-owned that round-trip no longer stores anything,
    and it should never have been the client's job to decide what the solver said.
    """
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.ASSIGN)

    refusal = assign_refusal(market)
    if refusal is not None:
        raise AssignPhaseError(refusal)

    if market.setup_object is None:
        return {"error": "Market has no setup configured"}, 400

    try:
        vendors = solver_vendors_for(market)
    except IncompleteApplicationsError as incomplete:
        # The organizer has to go and fix something, so say who - and where each one is.
        return {"error": incomplete.message(), "incomplete": incomplete.applicants()}, 400

    # Refused here for the same reason ``get_assigned_market`` refuses it: a run over nobody
    # produces a screen indistinguishable from a run that failed.
    if not vendors:
        return {"error": NOTHING_TO_ASSIGN}, 400

    # Read before the run, which replaces the market's assignment with the one it produced.
    held_before = [(seat.email, seat.date) for seat in market.assignment_object.vendor_assignments]
    market.assignment_object.assignment_statistics = None
    # Raises ``BrokenAllocationError`` on an allocation that breaks the solver's own rules (T253),
    # so nothing below it runs then: no store, no history entry, no payment change.
    assigned_market = assign_market(market, vendors)
    assignment = assigned_market.assignment_object

    Lifecycle.store(
        market, Lifecycle.Event.RUN, assignment.vendor_assignments,
        assignment_date=assignment.assignment_date,
        made_from=MadeFrom.fingerprint(market.setup_object, vendors, market.phase_history),
    )
    History.record_assignment_run(
        market_id,
        requesting_user,
        placements_written=len(assignment.vendor_assignments),
        pins_preserved=sum(1 for row in assignment.vendor_assignments if row.hand_placed),
    )
    # Every day held before the run or after it: a day it seats forgets its freed line, and a day
    # it drops forgets any freed record a stopped free left on it while it was held.
    PaymentsApi.seated_again(
        market_id,
        [*held_before, *((seat.email, seat.date) for seat in assignment.vendor_assignments)],
        held_before, requesting_user)

    # The same shape ``GET /markets/<id>/assignment`` returns, so a caller swapping to this one
    # reads the result the same way - the organization's display name included, because the
    # browser replaces the market it is holding with this response and the summary card reads it.
    payload = convert_keys_to_camel_case(assigned_market.model_dump())
    MarketsApi.leave_out_every_answer(payload)
    _organization, organization_dict = MarketsApi._load_organization_context(
        market.organization_id
    )
    if organization_dict:
        payload["organizationName"] = organization_dict.get("name")
    return payload, 200


def _said_day(date: str) -> str:
    """A market date as the screens say it, "May 1, 2099"; one that is not a calendar day as
    stored."""
    try:
        day = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        return date
    return f"{day:%b} {day.day}, {day.year}"


def write_placement(
    market_id: str, placement_data: Dict[str, Any], requesting_user: str
) -> Tuple[Dict[str, Any], int]:
    """Place one vendor in one seat on one date, replacing whatever they held that date.

    A move of a vendor who has checked in that day to another table asks first (``VendorIsHere``)
    unless ``while_here`` is true. Seating a vendor who holds no table that day asks nothing, a
    vendor freed while here included: it moves nobody, and gives them the table the roster says
    they lack.

    A vendor holds at most one seat per date, so a second placement on the same date moves them
    rather than giving them two. Whoever already sits in the target seat is left alone here: a
    seat contradiction is refused at pin time (E11/F02/S02), and trading two vendors is an
    operation of its own (E11/F03/S01), because a write that quietly displaces an occupant is
    how a vendor is silently unassigned on market day.
    """
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.ASSIGN)

    placement = _placement_for(
        market,
        email=str(placement_data.get("email") or "").strip(),
        date=str(placement_data.get("date") or "").strip(),
        table_code=str(placement_data.get("table_code") or "").strip(),
        table_choice=str(placement_data.get("table_choice") or "").strip(),
    )

    # Two vendors pinned to the same seat on the same date is a contradiction rather than a
    # preference the solver can weigh, and the moment to refuse it is now, while the organizer
    # can see both. Naming the occupant is the point: "that seat is taken" leaves them hunting.
    occupant = _seat_taken_by(market, placement)
    if occupant is not None:
        raise SeatTakenError(
            f"{occupant.email} already holds {placement.table_code} "
            f"({occupant.table_choice}) on {_said_day(placement.date)}. "
            "Choose another seat, or swap the two vendors."
        )

    stored = market.assignment_object.vendor_assignments
    left = next((existing for existing in stored
                 if existing.email == placement.email and existing.date == placement.date), None)
    moved = left is not None and left.table_code != placement.table_code
    while_here = moved and _ask_first_if_here(
        market, placement.date, [left], placement_data.get("while_here") is True)
    kept = [
        existing
        for existing in stored
        if not (existing.email == placement.email and existing.date == placement.date)
    ]
    kept.append(placement)

    Lifecycle.store(market, Lifecycle.Event.PLACE, kept,
                    assignment_date=market.assignment_object.assignment_date)
    History.record_placed(market_id, requesting_user, placement, left,
                          after_results=Lifecycle.results_published(market),
                          while_here=while_here)
    PaymentsApi.seated_again(market_id, [(placement.email, placement.date)],
                             [(left.email, left.date)] if left else [], requesting_user)

    return {"placement": convert_keys_to_camel_case(placement.model_dump())}, 200


def remove_placement(
    market_id: str, email: str, date: str, requesting_user: str, deduct_owed: bool = False,
    while_here: bool = False,
) -> Tuple[Dict[str, Any], int]:
    """Free the seat one vendor holds on one date.

    The counterpart of writing a placement, and the reason the product needs no "move" that
    displaces an occupant: freeing a seat first is safe, and mirrors what an organizer
    physically does. It is also how an orphaned pin is cleared, when the plan no longer has the
    seat it was promised and the organizer decides not to re-place it.

    Removing a placement nobody holds is not an error: the caller asked for that seat to be
    empty, and it is.

    ``deduct_owed`` is the free's question answered yes, "Also remove its $15.00 from what
    they owe?" (E44/F01/S02): the seat's line then owes $0 in the same change. It asks the row
    ``Actions.CHANGE_OWED`` too, before anything is freed.

    Freeing a vendor who has checked in that day asks first (``VendorIsHere``) unless
    ``while_here`` is true, before the line is kept or the seat freed, so the question writes
    nothing; the deduction asked rides on the request asked again.
    """
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.ASSIGN)
    if deduct_owed:
        refused = Actions.refusal(Actions.CHANGE_OWED, requesting_user, market,
                                  MarketsApi._load_organization(market.organization_id))
        if refused:
            raise ForbiddenError(refused)

    email = (email or "").strip()
    date = (date or "").strip()
    if not email or not date:
        raise PlacementError("Removing an assignment must name the vendor and the date.")

    kept = [
        existing
        for existing in market.assignment_object.vendor_assignments
        if not (existing.email == email and existing.date == date)
    ]
    freed = [
        existing
        for existing in market.assignment_object.vendor_assignments
        if existing.email == email and existing.date == date
    ]
    if freed:
        here = _ask_first_if_here(market, date, freed[:1], while_here)
        # Before the seat goes, while the market still says what it cost: freeing a table changes
        # neither what the vendor owes nor what they paid (E44/F01/S01), and the deduction asked is
        # in the same write, so no stop after the seat leaves it free and its full amount owed.
        # Kept first, so a seat whose line could not be kept is not freed.
        kept_line = PaymentsApi.keep_freed_line(market, email, date, requesting_user,
                                                deduct=deduct_owed)
        try:
            Lifecycle.store(market, Lifecycle.Event.FREE, kept,
                            assignment_date=market.assignment_object.assignment_date)
        except MarketChanged:
            # Refused, so the line goes back as it was: while the seat is still held, a freed record
            # left behind would come back as the line once that seat went some other way than a
            # free. Unless a free of the same seat landed meanwhile and kept its own record over
            # this one: that record, and any $0 it set, are the line's now.
            kept_line.undo()
            raise
        except BaseException:
            # Anything else may come after the store reached the database (a network error on
            # the way back), and then the seat is free and the line kept for it is the day's. So
            # the record goes back only while the stored assignment still seats them; when it
            # cannot be read, it stays, since a held seat reads its own price over a freed record
            # and the next write of the day forgets it.
            if _still_holds(market_id, email, date):
                kept_line.undo()
            raise
        for placement in freed:
            History.record_freed(
                market_id, requesting_user, email, date, placement.table_code,
                after_results=Lifecycle.results_published(market), while_here=here,
            )
        kept_line.record_deduction()
    elif deduct_owed:
        # Nothing to free: a free from before T270 that stopped after its seat left the day owing
        # its full amount, and pressing Free again is the retry that finishes the deduction.
        PaymentsApi.deduct_freed_day(market, email, date, requesting_user)

    return {"removed": len(freed)}, 200


def _still_holds(market_id: str, email: str, date: str) -> bool:
    """Whether the stored assignment still seats ``email`` on ``date``; False when it cannot be
    read, which leaves a free's kept line in place rather than risk taking a freed day's line."""
    try:
        stored = MarketsApi.markets_collection.find_one(
            live({"id": market_id}), {"assignmentObject.vendorAssignments": 1})
    except Exception:  # noqa: BLE001 - the free's own error is the one that goes on
        return False
    rows = ((stored or {}).get("assignmentObject") or {}).get("vendorAssignments") or []
    return any(row.get("email") == email and row.get("date") == date for row in rows)


def swap_placements(
    market_id: str, date: str, first_email: str, second_email: str, requesting_user: str,
    while_here: bool = False,
) -> Tuple[Dict[str, Any], int]:
    """Trade two vendors' seats on one date. Either both change or neither does.

    Atomic because two vendors trading is common enough that doing it as three separate
    operations - free one, move the other, place the first - invites a half-finished state, and
    the half-finished state is a vendor standing at no table on market day. One document update
    writes both rows, so there is no window in which one has moved and the other has not.

    This exists instead of a "move" that displaces whoever is already there. A move is how a
    vendor is silently unassigned; a swap says out loud that two people are changing places.

    A swap of a vendor who has checked in that day, either of the two, asks first (``VendorIsHere``,
    naming both when both are here) unless ``while_here`` is true.
    """
    market = MarketsApi._load_market_to_change(market_id, requesting_user, Actions.ASSIGN)

    date = (date or "").strip()
    first_email = (first_email or "").strip()
    second_email = (second_email or "").strip()
    if not date or not first_email or not second_email:
        raise PlacementError("A swap must name a date and two vendors.")
    if first_email == second_email:
        raise PlacementError("A vendor cannot swap seats with themselves.")

    placements = list(market.assignment_object.vendor_assignments)
    held = {
        placement.email: index
        for index, placement in enumerate(placements)
        if placement.date == date
    }
    for email in (first_email, second_email):
        if email not in held:
            raise PlacementError(f"{email} holds no table on {date}, so there is nothing to swap.")
        _applicant_address(market, email)

    first, second = placements[held[first_email]], placements[held[second_email]]
    here = _ask_first_if_here(market, date, [first, second], while_here)
    # The seat is everything about where they sit; only the vendor stays put. Flagged hand-placed
    # on both sides, because a swap is two deliberate placements.
    seat_fields = ("table_code", "table_choice", "section", "tier", "location")
    placements[held[first_email]] = first.model_copy(update={
        **{field: getattr(second, field) for field in seat_fields}, "hand_placed": True,
    })
    placements[held[second_email]] = second.model_copy(update={
        **{field: getattr(first, field) for field in seat_fields}, "hand_placed": True,
    })

    Lifecycle.store(market, Lifecycle.Event.PLACE, placements,
                    assignment_date=market.assignment_object.assignment_date)
    # One entry, because it was one action: a trade recorded as two placements reads as two
    # unrelated decisions a week later.
    History.record_swapped(
        market_id,
        requesting_user,
        date,
        placements[held[first_email]],
        placements[held[second_email]],
        after_results=Lifecycle.results_published(market),
        while_here=here,
    )

    # Both days were held, so a freed record on either is one a stopped free left, and goes.
    traded = [(first.email, date), (second.email, date)]
    PaymentsApi.seated_again(market_id, traded, traded, requesting_user)

    return {
        "placements": [
            convert_keys_to_camel_case(placements[held[first_email]].model_dump()),
            convert_keys_to_camel_case(placements[held[second_email]].model_dump()),
        ]
    }, 200
