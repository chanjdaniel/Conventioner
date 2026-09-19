from typing import List, Dict, Any, Optional
from collections import defaultdict
from datatypes import (
    Market, SetupObject, MarketDateObject, TierObject, SectionObject,
    ALL_OTHERS, APPLICATION_TYPE_RULE_TARGET, BUILT_IN_TARGET_PREFIX, SUBMITTED_AT_RULE_TARGET,
    AssignmentObject, AssignmentStatistics, VendorAssignmentResult, PriorityDirection,
    PriorityObject, LocationObject, table_code_for
)
from essential_fields import (
    TABLE_CHOICE_EITHER,
    TABLE_CHOICE_FULL,
    effective_essential_options_for_market,
)
from assignment.vendor_input import IncompleteApplication, SolverVendor, approved_solver_vendors


# Deliberately not including "1" and "0": those are numbers, and a numeric target whose answer
# is zero must sort as zero rather than as "false".
TRUE_ANSWERS = {"true", "yes", "y"}
FALSE_ANSWERS = {"false", "no", "n"}


def _as_magnitude(answer: str) -> Optional[float]:
    """An answer as something orderable, or None when it says nothing.

    A date sorts by when it happened, a number by how big it is, a yes/no by being true - and an
    ISO timestamp sorts correctly as text, so the earliest submission is simply the smallest
    string. Comparing them as one type keeps a single ordering rule for every magnitude target
    rather than one per stored shape.
    """
    answer = (answer or "").strip()
    if not answer:
        return None
    # Numbers first, so a numeric answer of zero is zero rather than a word that looks false.
    try:
        return float(answer)
    except ValueError:
        pass
    lowered = answer.lower()
    if lowered in TRUE_ANSWERS:
        return 0.0
    if lowered in FALSE_ANSWERS:
        return 1.0
    return _as_moment(answer)


def _as_moment(answer: str) -> Optional[float]:
    """A stored date or timestamp as a sortable number, or None when it is neither."""
    text = answer.strip().replace("Z", "+00:00")
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    if moment.tzinfo is None:
        return moment.timestamp()
    return moment.timestamp()

import math
from datetime import datetime
import traceback
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# temporary constants
FULL_TABLE_LABEL = "Full Table"
HALF_TABLE_LEFT_LABEL = "Half Table (Left)"
HALF_TABLE_RIGHT_LABEL = "Half Table (Right)"
NO_CLUB_MEMBERSHIP = "I am NOT a part of any of these clubs"
MAX_HALF_TABLES_PER_SECTION = 0.3

class Vendor:
    """A vendor during one assignment run: what they asked for, plus where they have been put.

    ``want`` is a ``SolverVendor`` and is immutable - it describes the application. Everything
    else here is state belonging to this run. Keeping the two apart is what stops the old failure
    mode returning: an answer is read from a named attribute of a typed record, so a wrong name
    raises instead of quietly reading as "the vendor answered nothing".
    """

    def __init__(self, want: SolverVendor, market_dates: List[MarketDateObject]):
        self.want = want
        self.num_assignments = 0
        self.assignment = dict.fromkeys(
            [market_date.date for market_date in market_dates], None
        )
        # How scarce this vendor is, used by sort_vendors to place the most constrained first.
        # Days are what a vendor is actually scarce in; the CSV era summed comma-separated tier
        # tokens across dates, conflating "how many days" with "how many tiers".
        self.date_flexibility = len(want.available_dates)

    def __repr__(self):
        return f"{vars(self)}"

    def assign(self, market_date: MarketDateObject, vendor_assignment: VendorAssignmentResult):
        self.assignment[market_date.date] = vendor_assignment
        self.num_assignments += 1

    def is_date_assigned(self, market_date: MarketDateObject):
        return self.assignment[market_date.date] is not None

    def is_available_on(self, market_date: MarketDateObject) -> bool:
        return market_date.date in self.want.available_dates

    def accepts_tier(self, market_date: MarketDateObject, tier: Optional[TierObject]) -> bool:
        """Delegated: the answer lives with the answers (``SolverVendor.accepts_tier_on``)."""
        return self.want.accepts_tier_on(market_date.date, tier.name if tier else None)




class Table:
    def __init__(self, date: MarketDateObject, table_code: str, section: SectionObject, tier: TierObject, location: LocationObject):
        self.date = date
        self.table_code = table_code
        self.section = section
        self.tier = tier
        self.location = location
        self.assignment = []
        
    def __repr__(self):
        return f"{vars(self)}"

    def availability(self):
        return 2 - len(self.assignment)

    def is_full(self):
        return len(self.assignment) == 2

    def available_table_choice(self):
        """Return a display label for the remaining availability at this table."""
        def _extract_assignment_field(row, key: str) -> str:
            def _snake_to_camel(s: str) -> str:
                parts = s.split("_")
                return parts[0] + "".join(p.capitalize() for p in parts[1:])

            if row is None:
                return ""
            if isinstance(row, dict):
                value = row.get(key) or row.get(_snake_to_camel(key)) or row.get(key.replace("_", ""))
                return str(value or "")
            value = (
                getattr(row, key, None)
                or getattr(row, _snake_to_camel(key), None)
                or getattr(row, key.replace("_", ""), None)
            )
            return str(value or "")

        def _normalize_half_side_label(choice: str) -> str:
            normalized = choice.strip().lower()
            if not normalized:
                return ""

            normalized = normalized.replace("-", " ")
            normalized = normalized.replace("(", " ").replace(")", " ")
            normalized = " ".join(normalized.split())

            # Accept common variants like:
            # "half table left", "half table (left)", "half table - left"
            if "half table" in normalized and "left" in normalized:
                return HALF_TABLE_LEFT_LABEL
            if "half table" in normalized and "right" in normalized:
                return HALF_TABLE_RIGHT_LABEL
            return ""

        if len(self.assignment) == 0:
            return FULL_TABLE_LABEL
        if len(self.assignment) == 1:
            assigned_vendor = self.assignment[0]
            choice = ""

            # Read the actual assigned side for this table/date from vendor assignments.
            # `Table.assignment` stores vendor objects (not assignment result objects).
            vendor_assignments = getattr(assigned_vendor, "assignment", None)
            if isinstance(vendor_assignments, dict):
                assigned_row = vendor_assignments.get(self.date.date)
                assigned_row_table_code = _extract_assignment_field(assigned_row, "table_code")
                if assigned_row is not None and assigned_row_table_code == self.table_code:
                    choice = _extract_assignment_field(assigned_row, "table_choice")

            normalized_choice = _normalize_half_side_label(choice)
            if normalized_choice == HALF_TABLE_LEFT_LABEL:
                return HALF_TABLE_RIGHT_LABEL
            if normalized_choice == HALF_TABLE_RIGHT_LABEL:
                return HALF_TABLE_LEFT_LABEL
            return "Half Table"
        return "Unavailable"

    def assign(self, vendors):
        self.assignment = vendors



class DateAssignment:
    def __init__(self, market_date: MarketDateObject, sections: List[SectionObject]):
        self.market_date = market_date
        self.tables = []

        # initialize tables from SectionObjects
        for section in sections:
            for i in range(section.count):
                table = Table(market_date, table_code_for(section.name, i + 1), section, section.tier, section.location)
                self.tables.append(table)

    def __repr__(self):
        return "\n".join([repr(table) for table in self.tables])



class MarketAssignment:
    def __init__(
        self,
        setup_object: SetupObject,
        vendors: List[SolverVendor],
        pinned: Optional[List[VendorAssignmentResult]] = None,
    ):
        self.setup_object = setup_object
        self.table_sharing = []
        self.date_assignments = {}
        self.half_tables = {}
        # Pins this plan can no longer hold: the vendor is no longer applying, the section was
        # deleted, the table count dropped below it, or the seat is already taken. Kept rather
        # than dropped - a pin is a deliberate guarantee, and losing one silently loses it for
        # good (E11/F02/S02 turns these into a blocker before the next assignment).
        self.orphaned_pins: List[VendorAssignmentResult] = []

        for market_date in setup_object.market_dates:
            self.date_assignments[market_date.date] = DateAssignment(
                market_date, setup_object.sections
            )

        self.vendors = [Vendor(want, setup_object.market_dates) for want in vendors]

        # Half tables taken per date per section, so the per-section proportion can be capped.
        # Keyed by the market date itself: a date IS its date, and the column heading a
        # spreadsheet once used to ask about it is not a second name for it.
        for market_date in setup_object.market_dates:
            self.half_tables[market_date.date] = {
                section.name: 0 for section in setup_object.sections
            }

        self._seat_pins(pinned or [])


    def _seat_pins(self, pinned: List[VendorAssignmentResult]) -> None:
        """Put the hand-placed vendors in their seats before anyone else is placed.

        Seating them first is the whole of "the solver works around pins": their seats are then
        occupied and their vendors already placed, so the ordinary loop below sees a floor with
        those tables taken and nothing else changes. A pinned vendor counts against their own
        assignment ceiling and against the section's half-table proportion, because they occupy
        a real seat on a real date.
        """
        for pin in pinned:
            date_assignment = self.date_assignments.get(pin.date)
            vendor = self.get_vendor_by_email(pin.email)
            table = (
                self.get_table_by_code(date_assignment.market_date, pin.table_code)
                if date_assignment is not None else None
            )
            # A whole table needs both seats; a half needs one. Checked rather than assumed,
            # because seating a full-table pin over a half-table occupant would evict them.
            seats_needed = 2 if pin.table_choice == FULL_TABLE_LABEL else 1
            if vendor is None or table is None or table.availability() < seats_needed:
                self.orphaned_pins.append(pin)
                # The vendor keeps the date the pin claimed, seated nowhere. Placing them
                # somewhere else instead would quietly answer the question the orphan asks -
                # the organizer promised this vendor that seat, and the plan no longer has it -
                # and would leave the vendor holding two rows for one date.
                if vendor is not None and date_assignment is not None:
                    vendor.assign(date_assignment.market_date, pin)
                continue

            vendor.assign(date_assignment.market_date, pin)
            if pin.table_choice == FULL_TABLE_LABEL:
                table.assign([vendor, vendor])
            else:
                table.assign(list(table.assignment) + [vendor])
                self.half_tables[pin.date][table.section.name] = (
                    self.half_tables[pin.date].get(table.section.name, 0) + 1
                )


    def __repr__(self):
        return f"{vars(self)}"

    def vendor_email(self, vendor: Vendor) -> str:
        return vendor.want.email

    def vendor_table_choice(self, vendor: Vendor) -> str:
        return vendor.want.table_choice or ""

    def _vendor_table_share_email_str(self, vendor: Vendor) -> str:
        return vendor.want.table_share_email or ""

    def _is_full_table_only(self, vendor: Vendor) -> bool:
        return vendor.want.table_choice == TABLE_CHOICE_FULL

    def _is_either_table_choice(self, vendor: Vendor) -> bool:
        return vendor.want.table_choice == TABLE_CHOICE_EITHER

    def market_max_assignments(self) -> Optional[int]:
        """The organizer's ceiling on how many dates one vendor may take, if they set one.

        This setting has existed all along: the setup UI renders it, clamps it to the market's
        date count, and persists it. The solver never read it - a hard-coded ``MAX_VENDING_DAYS
        = 4`` won everywhere - so an organizer could set it to six, watch it save, and get four.

        None means no ceiling, which is what "the organizer set none" should mean. There is no
        hidden default to replace the constant with: a market whose organizer named no limit is
        bounded by what each vendor asked for and by how many dates they can attend, both of
        which are real answers rather than a number nobody chose.
        """
        return self.setup_object.assignment_options.max_assignments_per_vendor

    def max_assignments_for(self, vendor: Vendor) -> Optional[int]:
        """The lower of the organizer's ceiling and what this vendor asked for."""
        caps = [
            cap for cap in (self.market_max_assignments(), vendor.want.max_dates)
            if cap is not None
        ]
        return min(caps) if caps else None

    def is_vendor_max_assigned(self, vendor: Vendor) -> bool:
        """Has this vendor taken every date they are entitled to?

        The vendor's own answer is an ``int`` on a typed record, so the CSV era's
        ``int(max_days_val[0])`` - which read one character, turning twelve dates into one - has
        nothing left to go wrong in.
        """
        cap = self.max_assignments_for(vendor)
        if cap is None:
            return False
        return vendor.num_assignments >= cap


    def _calculate_priority_score(self, vendor: Vendor) -> List[int]:
        """Where this vendor sorts under the organizer's rules. Lower is better.

        A rule names a target and carries its own ordering, so scoring is a lookup of the
        vendor's answer in that list. The old scheme addressed its target by index into
        ``col_names`` and kept the ordering in a parallel array with one entry required per
        column; a vendor has no columns now, and the index arithmetic is gone with them.

        One score per rule, in rule order, compared as a tuple - so an earlier rule always
        outranks a later one and a later rule only ever breaks a tie the earlier ones left.
        """
        scores = []
        for rule in sorted(self.setup_object.priority, key=lambda p: p.id):
            scores.append(self._rule_score(rule, vendor))
        return scores

    def _rule_score(self, rule: PriorityObject, vendor: Vendor):
        """This vendor's position under one rule. Lower sorts first.

        A rule with no target scores every vendor alike rather than raising: an organizer
        part-way through building a rule should not break the run they are building it for.

        Two shapes, and which one applies follows from the target rather than from anything the
        organizer declared. A target whose answers are a fixed set is ordered by arranging those
        answers; a target with magnitude - a number, a date, a yes/no - is ordered by direction.
        """
        if not rule.target:
            return 0
        if rule.ordering:
            return self._arranged_score(rule, vendor)
        if rule.direction:
            return self._magnitude_score(rule, vendor)
        return 0

    def _arranged_score(self, rule: PriorityObject, vendor: Vendor) -> int:
        answer = self._priority_answer(rule.target, vendor)
        if answer in rule.ordering:
            return rule.ordering.index(answer)
        if ALL_OTHERS in rule.ordering:
            return rule.ordering.index(ALL_OTHERS)
        # An answer the organizer neither placed nor covered sorts behind everyone they did.
        return len(rule.ordering)

    def _magnitude_score(self, rule: PriorityObject, vendor: Vendor) -> float:
        """Order by how much, how early, or whether.

        A vendor with no usable answer sorts last whichever direction the rule runs, rather than
        winning by default: an absent answer is not evidence of anything.
        """
        magnitude = _as_magnitude(self._priority_answer(rule.target, vendor))
        if magnitude is None:
            return math.inf
        if rule.direction == PriorityDirection.DESCENDING:
            return -magnitude
        return magnitude

    def _priority_answer(self, target: str, vendor: Vendor) -> str:
        """The vendor's answer to whatever a rule targets, as the ordering spells it."""
        if target and target.startswith(BUILT_IN_TARGET_PREFIX):
            return self._built_in_answer(target, vendor)
        value = vendor.want.custom_answers.get(target)
        if isinstance(value, list):
            # A multi-select answer has no single position. Its first choice is the one the
            # applicant put first, which is the only ordering information the answer carries.
            return str(value[0]).strip() if value else ""
        return "" if value is None else str(value).strip()

    def _built_in_answer(self, target: str, vendor: Vendor) -> str:
        """An attribute of the application rather than an answer the organizer asked for."""
        if target == SUBMITTED_AT_RULE_TARGET:
            return vendor.want.submitted_at or ""
        if target == APPLICATION_TYPE_RULE_TARGET:
            return vendor.want.application_type or ""
        return ""


    def sort_vendors(self):
        """Order vendors for placement. Earlier sorts first.

        The last key is a tiebreaker of last resort, and it is here so that two vendors nothing
        else separates are still ordered by something the market can explain. Without it the
        order is whatever the database happened to return, so the same market assigned twice
        could place different people and nobody could say why.
        """
        def sort_key(vendor):
            return (
                vendor.num_assignments,                 # Fewest assignments first
                self._calculate_priority_score(vendor), # The organizer's rules, in rule order
                vendor.date_flexibility,                # Most constrained first
                vendor.want.submitted_at or "",         # Then whoever applied earlier
                vendor.want.email,                      # Then something that is always distinct
            )

        self.vendors.sort(key=sort_key)

    def is_valid_vendor(self, vendor, market_date: MarketDateObject, table):
        return (
            vendor is not None
            and vendor.is_available_on(market_date)
            and vendor.accepts_tier(market_date, table.tier)
            and not self.is_vendor_max_assigned(vendor)
            and not vendor.is_date_assigned(market_date)
        )


    def get_vendor_by_email(self, email):
        for vendor in self.vendors:
            if self.vendor_email(vendor) == email:
                return vendor

    def get_table_by_code(self, market_date: MarketDateObject, table_code):
        date = market_date.date
        for table in self.date_assignments[date].tables:
            if table.table_code == table_code:
                return table

    # given a vendor, return with the vendor associated with table_share_email, else return None
    def get_table_share_vendor(self, vendor):
        table_share_email = self._vendor_table_share_email_str(vendor)
        for table_share_vendor in self.vendors:
            if table_share_email == self.vendor_email(table_share_vendor):
                return table_share_vendor
        return None

    # get next valid vendor with highest priority
    def best_table_for(self, vendor: Vendor, market_date: MarketDateObject):
        """The empty table this vendor should get, or None when nothing suits them.

        This is the inversion. The solver used to walk tables and ask each one which vendor it
        should take, under which a vendor's own section ranking could not influence anything -
        by the time a table asked, it had already decided which section it was in.

        A ranking is a permutation of the whole offering, so it excludes nothing: an unranked
        section is not refused, it merely sorts behind every ranked one. That is what makes this
        a preference rather than a filter, and it is why nobody goes unplaced for wanting
        something. Tier, in contrast, IS a filter, and ``is_valid_vendor`` has already applied it.
        """
        ranking = vendor.want.section_ranking

        def rank(table) -> int:
            try:
                return ranking.index(table.section.name)
            except ValueError:
                # Unranked sorts behind everything ranked, never out of consideration.
                return len(ranking)

        def has_room(table) -> bool:
            """Whether this vendor could sit here at all.

            An empty table suits anyone. A table holding one vendor has one seat left, and it
            suits anyone who did not ask for a whole table to themselves - that case only arises
            from a pin, because the ordinary loop fills both halves of a table in one step.
            Leaving it out would strand the open half of every half-table pin for the whole run.
            """
            if not table.assignment:
                return True
            return table.availability() == 1 and not self._is_full_table_only(vendor)

        candidates = [
            table for table in self.date_assignments[market_date.date].tables
            if has_room(table) and self.is_valid_vendor(vendor, market_date, table)
        ]
        if not candidates:
            return None
        # Stable within a rank, so the table order still decides among equally-preferred tables
        # and a re-run of the same market produces the same assignment. A half-empty table sorts
        # ahead of an empty one of equal rank: the room is already paid for.
        return min(candidates, key=lambda table: (rank(table), 0 if table.assignment else 1))


    def get_valid_vendor(self, market_date: MarketDateObject, table):
        for vendor in self.vendors:
            if self.is_valid_vendor(vendor, market_date, table):
                return vendor
        return None

    # return with a valid pair of vendors for a given table
    # [Vendor A, Vendor A] <-- one vendor, full table
    # [Vendor A, Vendor B] <-- two vendors, half tables
    def get_valid_vendors(self, market_date: MarketDateObject, table, next_vendor):
        """Who occupies ``table``, given that ``next_vendor`` is being placed at it.

        Returns ``[v, v]`` for one vendor holding a whole table, or ``[a, b]`` for two halves.
        The lead vendor is passed in rather than looked up: they were chosen by priority, and
        the table was then chosen to suit THEM. Picking the lead here, from the table, is what
        made a vendor's own section ranking unable to influence anything.
        """
        # The open half of a table someone already holds takes exactly one vendor: who they
        # share with was decided when the other half was filled.
        if table.assignment:
            return [next_vendor]

        # check for valid table sharing partner
        table_share_email = self._vendor_table_share_email_str(next_vendor)
        if table_share_email != "" and not self._is_full_table_only(next_vendor):
            table_share_vendor = self.get_table_share_vendor(next_vendor)
            if self.is_valid_vendor(table_share_vendor, market_date, table):
                self.table_sharing.append(next_vendor)
                self.table_sharing.append(table_share_vendor)
                return [next_vendor, table_share_vendor]

        # check if vendor selected full table only
        if self._is_full_table_only(next_vendor):
            return [next_vendor, next_vendor]

        # check if vendor selected either and if there are max half tables for the section
        if self._is_either_table_choice(next_vendor):
            if self.is_max_half_tables(market_date, table.section):
                return [next_vendor, next_vendor]

        # half table, loop to find next vendor for other half
        valid_vendors = [next_vendor]
        for vendor in self.vendors:
            if len(valid_vendors) == 2:
                break
            if not self.is_valid_vendor(vendor, market_date, table):
                continue
            if self.vendor_email(vendor) == self.vendor_email(next_vendor):
                continue
            if not self._is_full_table_only(vendor):
                valid_vendors.append(vendor)

        return valid_vendors


    def is_max_half_tables(self, market_date: MarketDateObject, section_object: SectionObject):
        date_key = market_date.date
        section = section_object.name
        return self.half_tables[date_key][section] / section_object.count >= MAX_HALF_TABLES_PER_SECTION

    def assign_table(self, market_date: MarketDateObject, vendor_list, table):

        # Filling the seat left open beside someone already at this table. The side is whichever
        # one they did not take, and the occupant keeps theirs - this appends rather than
        # replaces, because ``table.assign`` overwrites and overwriting would evict them.
        if table.assignment:
            vendor = vendor_list[0]
            free_side = table.available_table_choice()
            if free_side not in (HALF_TABLE_LEFT_LABEL, HALF_TABLE_RIGHT_LABEL):
                free_side = HALF_TABLE_RIGHT_LABEL
            vendor.assign(market_date, VendorAssignmentResult(
                email=self.vendor_email(vendor),
                date=market_date.date,
                table_code=table.table_code,
                table_choice=free_side,
                section=table.section.name,
                tier=table.tier.name,
                location=table.location.name
            ))
            self.half_tables[market_date.date][table.section.name] = (
                self.half_tables[market_date.date].get(table.section.name, 0) + 1
            )
            table.assign(list(table.assignment) + [vendor])
            return

        # full table assignment
        if len(vendor_list) < 2 or self.vendor_email(vendor_list[0]) == self.vendor_email(vendor_list[1]):
            assignment = VendorAssignmentResult(
                email=self.vendor_email(vendor_list[0]),
                date=market_date.date,
                table_code=table.table_code,
                table_choice=FULL_TABLE_LABEL,
                section=table.section.name,
                tier=table.tier.name,
                location=table.location.name
            )
            vendor_list[0].assign(market_date, assignment)
        else:
            # half table assignment
            for i, vendor in enumerate(vendor_list):
                table_choice = HALF_TABLE_LEFT_LABEL if i == 0 else HALF_TABLE_RIGHT_LABEL
                assignment = VendorAssignmentResult(
                    email=self.vendor_email(vendor),
                    date=market_date.date,
                    table_code=table.table_code,
                    table_choice=table_choice,
                    section=table.section.name,
                    tier=table.tier.name,
                    location=table.location.name
                )
                vendor.assign(market_date, assignment)
                self.half_tables[market_date.date][table.section.name] = self.half_tables[market_date.date].get(table.section.name, 0) + 1
        
        table.assign(vendor_list)

    def get_assignment_statistics(self) -> AssignmentStatistics:
        """Calculate and return comprehensive assignment statistics."""
        vendor_assignments = []
        assigned_vendors = set()
        unassigned_vendors = []
        
        # Collect all vendor assignments and track assigned/unassigned vendors
        for vendor in self.vendors:
            if vendor.num_assignments == 0:
                unassigned_vendors.append(self.vendor_email(vendor))
            else:
                assigned_vendors.add(self.vendor_email(vendor))
                for assignment in vendor.assignment.values():
                    if assignment is not None:
                        vendor_assignments.append(assignment)

        # Calculate total tables and count assigned tables
        total_tables = sum(len(da.tables) for da in self.date_assignments.values())
        assigned_tables_count = 0
        unassigned_tables = defaultdict(list)
        
        for date_assignment in self.date_assignments.values():
            date = date_assignment.market_date.date
            for table in date_assignment.tables:
                if table.assignment:
                    assigned_tables_count += 1
                if not table.is_full():
                    unassigned_tables[date].append({
                        "table_code": table.table_code,
                        "table_choice": table.available_table_choice(),
                    })

        # Seeded from the PLAN, not from what landed. A tier or a section that took nobody was
        # simply absent from these counts, which is exactly the row that explains a failed run:
        # "Gold: 0" says the run refused everyone who wanted Gold, while a missing Gold row says
        # nothing at all. Dates likewise.
        assignments_per_tier = defaultdict(int, {tier.name: 0 for tier in self.setup_object.tiers})
        assignments_per_section = defaultdict(
            int, {section.name: 0 for section in self.setup_object.sections}
        )
        assignments_per_date = defaultdict(
            int, {market_date.date: 0 for market_date in self.setup_object.market_dates}
        )
        # Table choice is not plan-derived - it is what vendors asked for - so it stays a tally of
        # what happened.
        assignments_per_table_choice = defaultdict(int)

        # Every assignment result now carries the market date itself, so there is nothing to
        # translate: a date had two names only while a spreadsheet column heading stood in for it.

        for assignment in vendor_assignments:
            assignments_per_tier[assignment.tier] += 1
            assignments_per_section[assignment.section] += 1
            assignments_per_table_choice[assignment.table_choice] += 1
            assignments_per_date[assignment.date] += 1

        # How much of what the vendors asked for they got, averaged over the vendors it was
        # possible to say that about.
        #
        # ``None`` when nobody could be scored - no vendors at all, or none with a single date
        # they could attend. It used to be 0.0 there, which reads as a run that satisfied nobody
        # rather than a run with nothing to satisfy, and an empty run reported "0.0%" as if it
        # were a bad result.
        #
        # A vendor with no potential assignment is left out of the average rather than counted as
        # a zero. They asked for nothing this market could give, so the solver neither satisfied
        # nor failed them, and counting them as a failure understates every real run they appear in.
        satisfaction_score_sum = 0.0
        scored_vendors = 0
        total_vendors = len(self.vendors)

        for vendor in self.vendors:
            # What this vendor could have had: every date they said they can attend, bounded by
            # the global ceiling and by the number of dates they actually asked for.
            num_requested_assignments = sum(
                1 for market_date in self.setup_object.market_dates
                if vendor.is_available_on(market_date)
            )

            caps: List[float] = [num_requested_assignments]
            cap = self.max_assignments_for(vendor)
            if cap is not None:
                caps.append(cap)
            num_potential_assignments = min(caps)

            if num_potential_assignments > 0:
                satisfaction_score_sum += vendor.num_assignments / num_potential_assignments
                scored_vendors += 1

        satisfaction_score = (
            satisfaction_score_sum / scored_vendors if scored_vendors > 0 else None
        )

        statistics = AssignmentStatistics(
            total_vendors=total_vendors,
            total_tables=total_tables,
            total_assignments=sum(vendor.num_assignments for vendor in self.vendors),
            total_assigned_vendors=len(assigned_vendors),
            total_assigned_tables=assigned_tables_count,
            unassigned_vendors=unassigned_vendors,
            unassigned_tables=dict(unassigned_tables),  # Convert defaultdict to regular dict
            assignments_per_tier=dict(assignments_per_tier),
            assignments_per_section=dict(assignments_per_section),
            assignments_per_table_choice=dict(assignments_per_table_choice),
            assignments_per_date=dict(assignments_per_date),
            satisfaction_score=satisfaction_score
        )

        return statistics

    def assign(self):
        """Place vendors, best-priority first, each at the best table still open to them.

        Vendor-driven rather than table-driven. Besides honouring section preference, this
        removes a defect the table-driven loop had: it stopped a date the moment one table could
        not be filled, but validity is answered per table - a vendor who accepts only one tier is
        not valid for a table of another - so an unfillable table early in the list left every
        later table empty however many vendors could have taken one.
        """
        for date_assignment in self.date_assignments.values():
            market_date = date_assignment.market_date
            self.sort_vendors()

            # A snapshot, because assigning re-sorts nothing until the next date: every vendor
            # gets one turn on this date, taken in priority order.
            for vendor in list(self.vendors):
                if vendor.is_date_assigned(market_date):
                    continue
                if self.is_vendor_max_assigned(vendor):
                    continue
                if not vendor.is_available_on(market_date):
                    continue

                table = self.best_table_for(vendor, market_date)
                if table is None:
                    continue

                self.assign_table(market_date, self.get_valid_vendors(market_date, table, vendor), table)
        self.sort_vendors()



class IncompleteApplicationsError(ValueError):
    """Approved applications that cannot be placed, raised before any assignment happens.

    Named applicants, not a count: an organizer meeting this has to go and fix something, and
    "three applications are incomplete" does not tell them which three.

    Refusing the whole run is the point. Skipping the offending vendors would hand back an
    assignment that looks complete with someone silently missing from it, and nobody would have
    any reason to look.
    """

    def __init__(self, incomplete: List[IncompleteApplication]):
        self.incomplete = list(incomplete)
        super().__init__(self.message())

    def message(self) -> str:
        applicants = "; ".join(
            f"{item.applicant_email or item.application_id} ({', '.join(item.reasons)})"
            for item in self.incomplete
        )
        return (
            f"{len(self.incomplete)} approved application(s) cannot be assigned until their "
            f"answers are complete: {applicants}"
        )


NOTHING_TO_ASSIGN = (
    "No applications have been approved for this market yet, so there is nothing to assign. "
    "Approve applications on the Applications tab, then assign."
)


def solver_vendors_for(market: Market) -> List[SolverVendor]:
    """The vendors a market's approved applications describe, or a refusal naming who is missing."""
    vendors, incomplete = approved_solver_vendors(
        market.id, effective_essential_options_for_market(market)
    )
    if incomplete:
        raise IncompleteApplicationsError(incomplete)
    return vendors


def describe_stored_assignment(
    market: Market, vendors: Optional[List[SolverVendor]] = None
) -> Market:
    """Describe the market's STORED assignment, recomputing nothing about it.

    Every read-only view - the statistics, the tables grid, the CSV, the Discord summary - used to
    run the solver afresh. That was harmless while the browser stored whatever it had been handed,
    and it is not harmless now: ``assignmentObject.vendorAssignments`` is what check-in reads at
    the door and what an organizer edits one seat at a time, so a screen drawn from a fresh run is
    a picture of what WOULD happen if they pressed Assign, and every seat they moved a vendor into
    would be a seat they had never actually seen.

    The stored rows are seated into a ``MarketAssignment`` and it is asked for statistics, without
    ``assign()`` ever running. One function therefore describes a run whether the solver has just
    produced it or it has been read back from the database, which is what keeps the payoff screen,
    the grid and the CSV from disagreeing about the same market.
    """
    if not market.setup_object:
        raise ValueError("Market must have setup data to describe an assignment")

    if vendors is None:
        vendors = solver_vendors_for(market)

    stored = list(market.assignment_object.vendor_assignments or [])
    seated = MarketAssignment(market.setup_object, vendors, stored)

    market.assignment_object = AssignmentObject(
        vendor_assignments=stored,
        assignment_date=market.assignment_object.assignment_date,
        assignment_statistics=seated.get_assignment_statistics(),
    )
    return market


def assign_market(market: Market, vendors: Optional[List[SolverVendor]] = None) -> Market:
    """Assign vendors to tables for a market.

    Vendors come from the market's own approved applications. A caller may pass them in - the
    tests do, to describe a scenario without a database - but no caller has to fetch anything
    first, which is what makes an application-intake market assignable at all.
    """
    if not market.setup_object:
        raise ValueError("Market must have setup data to perform assignment")

    if vendors is None:
        vendors = solver_vendors_for(market)

    # A pin is a hand-placed row on the market's own stored assignment, so a re-run reads the
    # guarantees the organizer already made and places everyone else around them. Without this
    # the solver recomputes wholesale and a pin lasts until the next press of Assign.
    pinned = [
        placement
        for placement in (market.assignment_object.vendor_assignments or [])
        if placement.hand_placed
    ]

    # Create market assignment instance
    market_assignment = MarketAssignment(market.setup_object, vendors, pinned)
    # Run the assignment algorithm
    market_assignment.assign()
    # logger.info(f"Market assigned: {market_assignment}")

    # Convert MarketAssignment to AssignmentObject format
    vendor_assignments = []
    assigned_vendors = set()
    assigned_tables = set()
    
    # Collect all vendor assignments
    for vendor in market_assignment.vendors:
        for date, assignment in vendor.assignment.items():
            if assignment is not None:
                vendor_assignments.append(assignment)
    
    # A pin this plan can no longer hold is kept, not deleted: it is a deliberate guarantee, and
    # dropping it here would lose it with nobody told. E11/F02/S02 raises them as a blocker.
    # Most are already here, held by the vendor whose date they claimed; the rest belong to
    # vendors this market no longer has, or to dates the plan no longer runs.
    vendor_assignments.extend(
        orphan for orphan in market_assignment.orphaned_pins
        if orphan not in vendor_assignments
    )

    # Create assignment object with results
    assignment_result = AssignmentObject(
        vendor_assignments=vendor_assignments,
        assignment_date=datetime.now().isoformat(),
        assignment_statistics=market_assignment.get_assignment_statistics()
    )
    
    # Update the market with assignment results
    market.assignment_object = assignment_result
    
    return market