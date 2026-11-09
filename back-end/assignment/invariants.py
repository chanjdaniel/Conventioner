"""What a table allocation must hold, judged from the plan, the vendors and the rows alone (T253).

The solver is greedy, and a greedy solver's defects are the kind no hand-written case thought
of: one gave a vendor a whole table, recorded them in one seat, and later put a second vendor on
the "free" half beside them. Nothing checked a result before it was stored, so such a result
would have reached the Assignments page, the door and the vendors. ``assign_market`` therefore
holds every allocation it produces to ``require_sound_allocation`` before it is returned, and
the seeded random markets in ``tests/test_assignment_invariants.py`` hold the solver to the
same function, so the rules are written once and the check and its oracle cannot disagree.

Pure on purpose: no database, no Flask, nothing from ``api/``. Everything it needs is passed in.

What it judges is what the solver produced, never the organizer's own decisions. Pins among
themselves, and a pin against its vendor's answers, are the organizer's: the placement write
refuses a second pin on a taken seat, and a pin that overrides an answer stands and is marked,
so refusing the run for them would block the organizer on what they chose and already see. An
orphaned pin is not seated by the solver, so it holds no seat here either: the solver may give
that seat to someone else, as it always has.

The soft rules (pairs together, the half-table share, the priority order, section ranking) are
kept where the greedy solver can keep them, not guaranteed, so they are pinned by the behaviour
suite's cases and are not judged here.
"""
from collections import defaultdict
from dataclasses import dataclass
from typing import TYPE_CHECKING, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from datatypes import (
    FULL_TABLE, HALF_TABLE_LEFT, HALF_TABLE_RIGHT,
    SectionObject, SetupObject, VendorAssignmentResult, table_code_for, table_code_sort_key,
)
from essential_fields import TABLE_CHOICE_FULL

if TYPE_CHECKING:
    # Typing only: importing it for real would bring ``api.applications`` with it.
    from assignment.vendor_input import SolverVendor


# The rules, in the order the breaches are reported. Each is the phrase the message uses.
PIN_NOT_KEPT = "a pin was not kept"
HAND_PLACED_BY_NOBODY = "a hand-placed row nobody placed"
OUTSIDE_THE_RUN = "an assignment for someone outside the run"
DATE_NOT_RUN = "a date the market does not run"
TABLE_NOT_IN_PLAN = "a table the plan does not have"
TABLE_MISDESCRIBED = "an assignment that misdescribes its table"
SEAT_NOT_ON_TABLE = "a seat the table does not have"
DAY_THEY_CANNOT_COME = "a day they cannot come"
TIER_NOT_CHOSEN = "a tier they did not choose that day"
HALF_FOR_WHOLE_TABLE = "a half for a vendor who asked for a whole table"
TWO_ON_ONE_DAY = "two assignments for one vendor on one day"
OVER_THEIR_LIMIT = "more days than their limit"
SEAT_TAKEN_TWICE = "a seat taken twice"

RULES = (
    PIN_NOT_KEPT,
    HAND_PLACED_BY_NOBODY,
    OUTSIDE_THE_RUN,
    DATE_NOT_RUN,
    TABLE_NOT_IN_PLAN,
    TABLE_MISDESCRIBED,
    SEAT_NOT_ON_TABLE,
    DAY_THEY_CANNOT_COME,
    TIER_NOT_CHOSEN,
    HALF_FOR_WHOLE_TABLE,
    TWO_ON_ONE_DAY,
    OVER_THEIR_LIMIT,
    SEAT_TAKEN_TWICE,
)

# The seats each way a row may be assigned as holds.
SEATS_HELD: Dict[str, Tuple[str, ...]] = {
    FULL_TABLE: ("left", "right"),
    HALF_TABLE_LEFT: ("left",),
    HALF_TABLE_RIGHT: ("right",),
}

# Who a row names when its address is nobody in the run. Never the address itself: the message
# reaches the server's log, which must never hold an applicant's address.
NOBODY_IN_THE_RUN = "outside the run"

# How many breaches the message spells out before it only counts the rest.
MESSAGE_LIMIT = 10


@dataclass(frozen=True)
class Breach:
    """One way an allocation breaks a rule: where, and for which applications.

    ``date`` and ``table_code`` are None when the rule is about a vendor rather than a seat.
    """

    rule: str
    date: Optional[str]
    table_code: Optional[str]
    application_ids: Tuple[str, ...]

    def describe(self) -> str:
        where = "".join((
            f" at {self.table_code}" if self.table_code is not None else "",
            f" on {self.date}" if self.date is not None else "",
        ))
        return f"{self.rule}{where} ({', '.join(self.application_ids)})"


class BrokenAllocationError(RuntimeError):
    """An allocation the solver produced breaks one of its own rules, so it is not kept.

    A builtin, never a ``ClientError``: this is a solver defect, the server's fault, so it
    escapes to the app's handler, which logs it and answers the generic 500. ``RuntimeError``
    rather than ``ValueError``, so no ``except ValueError`` meant for a library catches it, and
    rather than ``AssertionError``, so ``python -O`` cannot remove it.
    """

    def __init__(self, breaches: Sequence[Breach]):
        self.breaches = tuple(breaches)
        super().__init__(self.message())

    def message(self) -> str:
        shown = "; ".join(breach.describe() for breach in self.breaches[:MESSAGE_LIMIT])
        rest = len(self.breaches) - MESSAGE_LIMIT
        more = f"; and {rest} more" if rest > 0 else ""
        return f"The table allocation breaks the solver's rules, so it was not kept: {shown}{more}"


def require_sound_allocation(
    setup: SetupObject,
    vendors: Sequence["SolverVendor"],
    pins: Sequence[VendorAssignmentResult],
    orphaned_pins: Sequence[VendorAssignmentResult],
    assignments: Sequence[VendorAssignmentResult],
) -> None:
    """Raise ``BrokenAllocationError`` when ``allocation_breaches`` finds anything."""
    breaches = allocation_breaches(setup, vendors, pins, orphaned_pins, assignments)
    if breaches:
        raise BrokenAllocationError(breaches)


def allocation_breaches(
    setup: SetupObject,
    vendors: Sequence["SolverVendor"],
    pins: Sequence[VendorAssignmentResult],
    orphaned_pins: Sequence[VendorAssignmentResult],
    assignments: Sequence[VendorAssignmentResult],
) -> List[Breach]:
    """Every way ``assignments`` breaks a hard rule of the solver; empty when it is sound.

    ``vendors`` are the run's vendors, ``pins`` the hand-placed rows the run started from,
    ``orphaned_pins`` the pins the solver could not seat, and ``assignments`` the rows the run
    produced, pins included. Ordered by rule, then date, table (as a person counts them) and
    application ids.
    """
    by_email = {vendor.email: vendor for vendor in vendors}
    market_dates = {market_date.date for market_date in setup.market_dates}
    sections_by_table: Dict[str, SectionObject] = {
        table_code_for(section.name, n): section
        for section in setup.sections
        for n in range(1, section.count + 1)
    }
    pin_keys = {_key(pin) for pin in pins}
    orphan_keys = {_key(orphan) for orphan in orphaned_pins}
    row_keys = {_key(row) for row in assignments}

    def who(email: str) -> str:
        vendor = by_email.get(email)
        return vendor.application_id if vendor is not None else NOBODY_IN_THE_RUN

    breaches: List[Breach] = []

    def breach(rule: str, date: Optional[str], table_code: Optional[str], emails: Iterable[str]):
        ids = tuple(sorted({who(email) for email in emails}))
        breaches.append(Breach(rule, date, table_code, ids))

    for pin in pins:
        if _key(pin) not in row_keys:
            breach(PIN_NOT_KEPT, pin.date, pin.table_code, [pin.email])

    for row in assignments:
        if row.hand_placed and _key(row) not in pin_keys:
            breach(HAND_PLACED_BY_NOBODY, row.date, row.table_code, [row.email])

    solver_rows = [row for row in assignments if not row.hand_placed]
    for row in solver_rows:
        _judge_solver_row(row, by_email.get(row.email), market_dates, sections_by_table, breach)

    rows_by_vendor_and_date: Dict[Tuple[str, str], List[VendorAssignmentResult]] = defaultdict(list)
    for row in assignments:
        rows_by_vendor_and_date[(row.email, row.date)].append(row)
    for (email, date), rows in rows_by_vendor_and_date.items():
        if len(rows) > 1 and any(not row.hand_placed for row in rows):
            breach(TWO_ON_ONE_DAY, date, None, [email])

    # Counted as the solver counts them: every date of the plan the vendor holds, a pin or an
    # orphaned pin on it included. A pin on a date the plan no longer runs counts for nothing.
    ceiling = setup.assignment_options.max_assignments_per_vendor
    dates_held: Dict[str, Set[str]] = defaultdict(set)
    for row in assignments:
        if row.date in market_dates:
            dates_held[row.email].add(row.date)
    for email in {row.email for row in solver_rows}:
        vendor = by_email.get(email)
        if vendor is None:
            continue
        limits = [limit for limit in (ceiling, vendor.max_dates) if limit is not None]
        if limits and len(dates_held[email]) > min(limits):
            breach(OVER_THEIR_LIMIT, None, None, [email])

    holders: Dict[Tuple[str, str, str], List[VendorAssignmentResult]] = defaultdict(list)
    for row in assignments:
        if row.hand_placed and _key(row) in orphan_keys:
            continue
        for seat in SEATS_HELD.get(row.table_choice, ()):
            holders[(row.date, row.table_code, seat)].append(row)
    taken_twice: Dict[Tuple[str, str], Set[str]] = defaultdict(set)
    for (date, table_code, _seat), rows in holders.items():
        if len(rows) > 1 and any(not row.hand_placed for row in rows):
            taken_twice[(date, table_code)].update(row.email for row in rows)
    for (date, table_code), emails in taken_twice.items():
        breach(SEAT_TAKEN_TWICE, date, table_code, emails)

    return sorted(breaches, key=_order)


def _judge_solver_row(row, vendor, market_dates, sections_by_table, breach) -> None:
    """Rules 3 to 10, for one row the solver made."""
    if vendor is None:
        # Nobody to judge the row against: a held vendor holds pins only.
        breach(OUTSIDE_THE_RUN, row.date, row.table_code, [row.email])
        return
    if row.date not in market_dates:
        breach(DATE_NOT_RUN, row.date, row.table_code, [row.email])
    section = sections_by_table.get(row.table_code)
    if section is None:
        breach(TABLE_NOT_IN_PLAN, row.date, row.table_code, [row.email])
    else:
        # A section may have no tier and no location; the solver writes "" for each (bug 23).
        described = (
            section.name,
            section.tier.name if section.tier else "",
            section.location.name if section.location else "",
        )
        if (row.section, row.tier, row.location) != described:
            breach(TABLE_MISDESCRIBED, row.date, row.table_code, [row.email])
    if row.table_choice not in SEATS_HELD:
        breach(SEAT_NOT_ON_TABLE, row.date, row.table_code, [row.email])
    if row.date not in vendor.available_dates:
        breach(DAY_THEY_CANNOT_COME, row.date, row.table_code, [row.email])
    if section is not None and not vendor.accepts_tier_on(
        row.date, section.tier.name if section.tier else None
    ):
        breach(TIER_NOT_CHOSEN, row.date, row.table_code, [row.email])
    if vendor.table_choice == TABLE_CHOICE_FULL and row.table_choice != FULL_TABLE:
        breach(HALF_FOR_WHOLE_TABLE, row.date, row.table_code, [row.email])


def _key(row: VendorAssignmentResult) -> Tuple:
    """A row as something a set can hold: equal exactly when the two rows are equal."""
    return tuple(row.model_dump().values())


def _order(breach: Breach) -> Tuple:
    return (
        RULES.index(breach.rule),
        breach.date or "",
        table_code_sort_key(breach.table_code or ""),
        breach.application_ids,
    )
