from typing import List, Dict, Any, Optional
from collections import defaultdict
from datatypes import (
    Market, SetupObject, MarketDateObject, TierObject, SectionObject,
    AssignmentObject, AssignmentStatistics, VendorAssignmentResult, PriorityObject, DataType,
    LocationObject
)
from essential_fields import (
    TABLE_CHOICE_EITHER,
    TABLE_CHOICE_FULL,
    effective_essential_options_for_market,
)
from assignment.vendor_input import IncompleteApplication, SolverVendor, approved_solver_vendors

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

    def accepts_tier(self, tier: TierObject) -> bool:
        """Set membership, not a substring test.

        The CSV-era check was ``table.tier.name in <the vendor's answer string>``, in which a
        tier named 'A' matched an answer of 'AB'. A market offering no tiers constrains nothing,
        so every table is acceptable.
        """
        if not self.want.accepted_tiers:
            return True
        return tier.name in self.want.accepted_tiers




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
                table = Table(market_date, section.name + f"{i + 1}", section, section.tier, section.location)
                self.tables.append(table)

    def __repr__(self):
        return "\n".join([repr(table) for table in self.tables])



class MarketAssignment:
    def __init__(self, setup_object: SetupObject, vendors: List[SolverVendor]):
        self.setup_object = setup_object
        self.table_sharing = []
        self.date_assignments = {}
        self.half_tables = {}

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
        """Priority ordering, pending its rewrite.

        The old scheme addressed its target by index into ``col_names`` and read the ordering
        out of ``enum_priority_order``, a parallel array with one entry per column. A vendor no
        longer has columns, so that scheme has no addressing left and cannot be ported - it is
        replaced in E02/F02, where a rule names a form field or an application attribute and its
        ordering lives on the rule itself.

        Until then every vendor scores alike and the remaining sort keys decide. That is a
        smaller change than it sounds: the solver already ignored ``data_type`` and
        ``sorting_order`` entirely, so any rule an organizer configured as anything but an
        enumerated ordering already scored every vendor identically.
        """
        return []


    def sort_vendors(self):
        """Sort vendors by assignment priority using priority configuration."""
        def sort_key(vendor):
            # Calculate priority scores based on enumPriorityOrder
            priority_scores = self._calculate_priority_score(vendor)
            
            return (
                vendor.num_assignments,  # Fewest assignments first
                priority_scores,         # Priority-based sorting
                vendor.date_flexibility, # Lowest flexibility first
            )
        
        self.vendors.sort(key=sort_key)

    def is_valid_vendor(self, vendor, market_date: MarketDateObject, table):
        return (
            vendor is not None
            and vendor.is_available_on(market_date)
            and vendor.accepts_tier(table.tier)
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
    def get_valid_vendor(self, market_date: MarketDateObject, table):
        for vendor in self.vendors:
            if self.is_valid_vendor(vendor, market_date, table):
                return vendor
        return None

    # return with a valid pair of vendors for a given table
    # [Vendor A, Vendor A] <-- one vendor, full table
    # [Vendor A, Vendor B] <-- two vendors, half tables
    def get_valid_vendors(self, market_date: MarketDateObject, table):
        date = market_date.date
        next_vendor = self.get_valid_vendor(market_date, table)

        # check if no more valid vendors
        if next_vendor == None:
            return None

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
            # exit loop when valid_vendors is full
            if len(valid_vendors) == 2:
                break
            
            # check: valid table tier, vendor not max assigned, vendor not assigned for date
            if not self.is_valid_vendor(vendor, market_date, table):
                continue

            # check not equal to next_vendor
            if self.vendor_email(vendor) == self.vendor_email(next_vendor):
                continue

            # append if vendor selected half table
            if not self._is_full_table_only(vendor):
                valid_vendors.append(vendor)
                
        return valid_vendors

    def is_max_half_tables(self, market_date: MarketDateObject, section_object: SectionObject):
        date_col_name = market_date.date
        section = section_object.name
        return self.half_tables[date_col_name][section] / section_object.count >= MAX_HALF_TABLES_PER_SECTION

    def assign_table(self, market_date: MarketDateObject, vendor_list, table):
        
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

    def manually_assign(self, market_date: MarketDateObject, vendor, table_code):
        table = self.get_table_by_code(market_date, table_code)
        vendor_list = [vendor, vendor]
        vendor.assign(market_date, VendorAssignmentResult(
            email=self.vendor_email(vendor),
            date=market_date.date,
            table_code=table_code,
            table_choice=FULL_TABLE_LABEL,
            section=table.section.name,
            tier=table.tier.name,
            location=table.location.name
        ))
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

        # Count assignments by category using defaultdict for cleaner code
        assignments_per_tier = defaultdict(int)
        assignments_per_section = defaultdict(int)
        assignments_per_table_choice = defaultdict(int)
        assignments_per_date = defaultdict(int)

        # Every assignment result now carries the market date itself, so there is nothing to
        # translate: a date had two names only while a spreadsheet column heading stood in for it.

        for assignment in vendor_assignments:
            assignments_per_tier[assignment.tier] += 1
            assignments_per_section[assignment.section] += 1
            assignments_per_table_choice[assignment.table_choice] += 1
            assignments_per_date[assignment.date] += 1

        # Calculate satisfaction score (average ratio of actual to potential assignments)
        satisfaction_score_sum = 0.0
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
            
            # Avoid division by zero
            if num_potential_assignments > 0:
                satisfaction_score_sum += vendor.num_assignments / num_potential_assignments
        
        # Calculate average satisfaction score, handling empty vendor list
        satisfaction_score = (
            satisfaction_score_sum / total_vendors 
            if total_vendors > 0 else 0.0
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
        # loop market dates
        for _, date_assignment in self.date_assignments.items():
            market_date = date_assignment.market_date

            # sort vendors
            self.sort_vendors()

            # loop tables
            for table in date_assignment.tables:
                
                vendor_list = self.get_valid_vendors(market_date, table)

                # break if no more valid vendors
                if vendor_list == None:
                    break

                self.assign_table(market_date, vendor_list, table)
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


def solver_vendors_for(market: Market) -> List[SolverVendor]:
    """The vendors a market's approved applications describe, or a refusal naming who is missing."""
    vendors, incomplete = approved_solver_vendors(
        market.id, effective_essential_options_for_market(market)
    )
    if incomplete:
        raise IncompleteApplicationsError(incomplete)
    return vendors


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

    # Create market assignment instance
    market_assignment = MarketAssignment(market.setup_object, vendors)
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
    
    # Create assignment object with results
    assignment_result = AssignmentObject(
        vendor_assignments=vendor_assignments,
        assignment_date=datetime.now().isoformat(),
        assignment_statistics=market_assignment.get_assignment_statistics()
    )
    
    # Update the market with assignment results
    market.assignment_object = assignment_result
    
    return market