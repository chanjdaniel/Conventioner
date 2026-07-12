from typing import List, Dict, Any, Optional
from collections import defaultdict
from datatypes import (
    Market, SetupObject, MarketDateObject, TierObject, SectionObject, 
    AssignmentObject, AssignmentStatistics, VendorAssignmentResult, PriorityObject, DataType,
    LocationObject
)

import math
from datetime import datetime
import traceback
import logging

from assignment.validator import Validator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# temporary constants
FULL_TABLE_ONLY_CHOICES = {"full table", "full table only"}
HALF_TABLE_ONLY_CHOICES = {"half table", "half table only"}
EITHER_TABLE_CHOICES = {"either"}
FULL_TABLE_LABEL = "Full Table"
HALF_TABLE_LEFT_LABEL = "Half Table (Left)"
HALF_TABLE_RIGHT_LABEL = "Half Table (Right)"
NO_CLUB_MEMBERSHIP = "I am NOT a part of any of these clubs"
MAX_VENDING_DAYS = 4
MAX_HALF_TABLES_PER_SECTION = 0.3

def toAttrString(str):
    str = str.lower()
    str = str.replace(' ', '_')
    return str

class Vendor:
    def __init__(self, entry, market_dates: List[MarketDateObject]):
        self.num_assignments = 0
        
        # initialize assignment dict from market dates
        dates = [market_date.date for market_date in market_dates]
        self.assignment = dict.fromkeys(dates, None)

        # set attributes using row of vendor dataframe
        for key, value in entry.items():
            setattr(self, toAttrString(key), value)
        
        self.date_flexibility = self._calculate_date_flexibility(market_dates)

    def _calculate_date_flexibility(self, market_dates: List[MarketDateObject]) -> int:
        flexibility = 0
        for market_date in market_dates:
            date_attr = toAttrString(market_date.col_name)
            if hasattr(self, date_attr):
                date_value = getattr(self, date_attr, '')
                if date_value and date_value != '':
                    flexibility += len(str(date_value).split(','))
        return flexibility

    def __repr__(self):
        return f"{vars(self)}"

    def assign(self, market_date: MarketDateObject, vendor_assignment: VendorAssignmentResult):
        self.assignment[market_date.date] = vendor_assignment
        self.num_assignments += 1

    def is_date_assigned(self, market_date: MarketDateObject):
        return self.assignment[market_date.date] != None

    def is_max_assigned(self):
        try:
            max_days_val = getattr(self, 'max_days', None)
            vendor_max_days = int(max_days_val[0]) if max_days_val else MAX_VENDING_DAYS
        except (ValueError, IndexError, TypeError, AttributeError):
            vendor_max_days = MAX_VENDING_DAYS
        return self.num_assignments >= MAX_VENDING_DAYS or self.num_assignments >= vendor_max_days



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



def _validate_assignment_column_mappings(setup_object: SetupObject) -> None:
    """Require every column index the solver dereferences to be set and in range.

    The CSV-derived fields are optional on the models so application-based markets can omit
    them, so a setup object that reaches the solver has to be checked here instead.
    """
    ao = setup_object.assignment_options
    n = len(setup_object.col_names)
    if n == 0:
        raise ValueError(
            "setup_object.col_names is empty; this market has no CSV columns to map"
        )

    def require_idx(field: str, idx: Optional[int]) -> None:
        if idx is None:
            raise ValueError(
                f"setup_object.{field} must be set to a column index (no legacy default names)"
            )
        i = int(idx)
        if i < 0 or i >= n:
            raise ValueError(
                f"setup_object.{field} must be a valid column index (0..{n - 1})"
            )

    require_idx("assignment_options.email_col_name_idx", ao.email_col_name_idx)
    require_idx("assignment_options.table_choice_col_name_idx", ao.table_choice_col_name_idx)
    require_idx("assignment_options.table_share_email_col_name_idx", ao.table_share_email_col_name_idx)
    if ao.max_days_col_name_idx is not None:
        require_idx("assignment_options.max_days_col_name_idx", ao.max_days_col_name_idx)

    for i, market_date in enumerate(setup_object.market_dates):
        if not market_date.col_name:
            require_idx(f"market_dates[{i}].col_name_idx", market_date.col_name_idx)

    enum_count = len(setup_object.enum_priority_order)
    for i, priority_item in enumerate(setup_object.priority):
        field = f"priority[{i}].col_name_idx"
        require_idx(field, priority_item.col_name_idx)
        if priority_item.col_name_idx >= enum_count:
            raise ValueError(
                f"setup_object.{field} ({priority_item.col_name_idx}) is out of range for "
                f"setup_object.enum_priority_order (length {enum_count})"
            )


class MarketAssignment:
    def __init__(self, setup_object: SetupObject, source_data: Dict[str, Any]):
        _validate_assignment_column_mappings(setup_object)
        self.setup_object = setup_object
        self.source_data = source_data
        self.table_sharing = []
        self.date_assignments = {}
        self.half_tables = {}

        # initialize market date column names
        for market_date in setup_object.market_dates:
            if not market_date.col_name:
                market_date_col_name = setup_object.col_names[market_date.col_name_idx]
                market_date.col_name = market_date_col_name

        # initialize date assignments from market dates
        for market_date in setup_object.market_dates:
            self.date_assignments[market_date.date] = DateAssignment(market_date, setup_object.sections)

        # initialize vendors from vendor data frame
        vendor_rows = self._get_vendor_rows()
        self.vendors = []
        for row_entry in vendor_rows:
            self.vendors.append(Vendor(row_entry, setup_object.market_dates))

        # initialize half tables dict
        for market_date in setup_object.market_dates:
            date_col_name = market_date.col_name
            self.half_tables[date_col_name] = {}
            for section in setup_object.sections:
                self.half_tables[date_col_name][section.name] = 0

    def __repr__(self):
        return f"{vars(self)}"

    def _mapped_col_idx(self, idx: Optional[int]) -> Optional[int]:
        if idx is None:
            return None
        n = len(self.setup_object.col_names)
        if idx < 0 or idx >= n:
            return None
        return idx

    def _vendor_field_at(self, vendor: Vendor, col_name_idx: int) -> str:
        mid = self._mapped_col_idx(col_name_idx)
        if mid is None:
            raise ValueError("column index is required")
        return str(self._get_vendor_column_value(vendor, mid) or "")

    def _vendor_table_share_email_str(self, vendor: Vendor) -> str:
        ao = self.setup_object.assignment_options
        return self._vendor_field_at(vendor, ao.table_share_email_col_name_idx)

    def vendor_email(self, vendor: Vendor) -> str:
        ao = self.setup_object.assignment_options
        return self._vendor_field_at(vendor, ao.email_col_name_idx)

    def vendor_table_choice(self, vendor: Vendor) -> str:
        ao = self.setup_object.assignment_options
        return self._vendor_field_at(vendor, ao.table_choice_col_name_idx)

    def _normalized_table_choice(self, vendor: Vendor) -> str:
        return self.vendor_table_choice(vendor).strip().lower()

    def _is_full_table_only(self, vendor: Vendor) -> bool:
        return self._normalized_table_choice(vendor) in FULL_TABLE_ONLY_CHOICES

    def _is_either_table_choice(self, vendor: Vendor) -> bool:
        return self._normalized_table_choice(vendor) in EITHER_TABLE_CHOICES

    def _max_days_raw(self, vendor: Vendor):
        """Cell value for max-days column, or None if unmapped / blank cell (no per-vendor cap from CSV)."""
        ao = self.setup_object.assignment_options
        mid = self._mapped_col_idx(ao.max_days_col_name_idx)
        if mid is None:
            return None
        v = self._get_vendor_column_value(vendor, mid)
        return v if v != "" else None

    def _parse_vendor_max_days_int(self, max_days_val) -> Optional[int]:
        if max_days_val is None or max_days_val == "":
            return None
        try:
            return int(max_days_val[0]) if max_days_val else None
        except (ValueError, IndexError, TypeError):
            return None

    def is_vendor_max_assigned(self, vendor: Vendor) -> bool:
        if vendor.num_assignments >= MAX_VENDING_DAYS:
            return True
        ao = self.setup_object.assignment_options
        if ao.max_days_col_name_idx is None:
            return False
        max_days_val = self._max_days_raw(vendor)
        vendor_max_days = self._parse_vendor_max_days_int(max_days_val)
        if vendor_max_days is None:
            return False
        return vendor.num_assignments >= vendor_max_days

    def _get_column_values(self, col_name: str) -> List[str]:
        for idx, column in enumerate(self.setup_object.col_names):
            if toAttrString(column) == toAttrString(col_name):
                return self.source_data["data"][idx]
        raise ValueError(f"Column {col_name} not found in setup object")

    def _get_vendor_rows(self) -> List[Dict[str, str]]:
        vendor_rows = []
        # Get the header row (first row in data)
        headers = self.source_data["data"][0]
        
        # Iterate through data rows (skip header row)
        for i in range(1, len(self.source_data["data"])):  # Start from 1 to skip header
            row = {}
            for j in range(len(headers)):
                col_name = self.setup_object.col_names[j]
                if j < len(self.source_data["data"][i]):  # Check bounds
                    row[col_name] = self.source_data["data"][i][j]
                else:
                    row[col_name] = ""  # Default value for missing columns
            vendor_rows.append(row)
        return vendor_rows

    def _get_vendor_column_value(self, vendor: Vendor, col_name_idx: int) -> str:
        # Must use setup_object.col_names — vendor rows are keyed by those names in _get_vendor_rows,
        # not by source_data["headers"]. If they differ, using headers here yields empty strings everywhere.
        if col_name_idx >= len(self.setup_object.col_names):
            raise ValueError(
                f"Column index {col_name_idx} out of range for col_names: {self.setup_object.col_names}"
            )
        col_name = self.setup_object.col_names[col_name_idx]
        attr_name = toAttrString(col_name)
        return getattr(vendor, attr_name, "")

    def _calculate_priority_score(self, vendor: Vendor) -> List[int]:
        """Calculate priority scores for a vendor based on priority configuration."""
        scores = []
        
        # Sort priority items by their id (lower id = higher priority)
        sorted_priorities = sorted(self.setup_object.priority, key=lambda p: p.id)
        
        for priority_item in sorted_priorities:
            col_name_idx = priority_item.col_name_idx
            enum_order = self.setup_object.enum_priority_order[col_name_idx]
            
            # Skip if enum order is empty
            if not enum_order:
                scores.append(0)
                continue
            
            vendor_value = self._get_vendor_column_value(vendor, col_name_idx)
            
            # Find the index of the vendor's value in the enum order
            try:
                value_index = enum_order.index(vendor_value)
                scores.append(value_index)
            except ValueError:
                # If value not found in enum order, check for "<All others>" token
                if "<All others>" in enum_order:
                    all_others_index = enum_order.index("<All others>")
                    scores.append(all_others_index)
                else:
                    # If no "<All others>" token, put at the end
                    scores.append(len(enum_order))
        
        return scores

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
            and table.tier.name in getattr(vendor, toAttrString(market_date.col_name), '')
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
        date_col_name = market_date.col_name
        section = section_object.name
        return self.half_tables[date_col_name][section] / section_object.count >= MAX_HALF_TABLES_PER_SECTION

    def assign_table(self, market_date: MarketDateObject, vendor_list, table):
        
        # full table assignment
        if len(vendor_list) < 2 or self.vendor_email(vendor_list[0]) == self.vendor_email(vendor_list[1]):
            assignment = VendorAssignmentResult(
                email=self.vendor_email(vendor_list[0]),
                date=market_date.col_name,
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
                    date=market_date.col_name,
                    table_code=table.table_code,
                    table_choice=table_choice,
                    section=table.section.name,
                    tier=table.tier.name,
                    location=table.location.name
                )
                vendor.assign(market_date, assignment)
                self.half_tables[market_date.col_name][table.section.name] = self.half_tables[market_date.col_name].get(table.section.name, 0) + 1
        
        table.assign(vendor_list)

    def manually_assign(self, market_date: MarketDateObject, vendor, table_code):
        table = self.get_table_by_code(market_date, table_code)
        vendor_list = [vendor, vendor]
        vendor.assign(market_date, VendorAssignmentResult(
            email=self.vendor_email(vendor),
            date=market_date.col_name,
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

        col_name_to_date = {}
        for market_date in self.setup_object.market_dates:
            col_name_to_date[market_date.date] = market_date.date
            if market_date.col_name:
                col_name_to_date[market_date.col_name] = market_date.date

        for assignment in vendor_assignments:
            assignments_per_tier[assignment.tier] += 1
            assignments_per_section[assignment.section] += 1
            assignments_per_table_choice[assignment.table_choice] += 1
            canonical_date = col_name_to_date.get(assignment.date, assignment.date)
            assignments_per_date[canonical_date] += 1

        # Calculate satisfaction score (average ratio of actual to potential assignments)
        satisfaction_score_sum = 0.0
        total_vendors = len(self.vendors)
        
        for vendor in self.vendors:
            # Count how many dates the vendor requested
            num_requested_assignments = sum(
                1 for market_date in self.setup_object.market_dates
                if getattr(vendor, toAttrString(market_date.col_name), '') != ""
            )
            
            # Potential assignments: cap by global max, dates requested, and optional per-vendor max-days column
            ao = self.setup_object.assignment_options
            caps: List[float] = [MAX_VENDING_DAYS, num_requested_assignments]
            if ao.max_days_col_name_idx is not None:
                vd = self._parse_vendor_max_days_int(self._max_days_raw(vendor))
                if vd is not None:
                    caps.append(vd)
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


def assign_market(market: Market, source_data: Dict[str, Any]) -> Market:
    """Assign vendors to tables for a market."""
    if not market.setup_object:
        raise ValueError("Market must have setup data to perform assignment")
    
    # Create market assignment instance
    market_assignment = MarketAssignment(market.setup_object, source_data)
    # Run the assignment algorithm
    market_assignment.assign()
    # logger.info(f"Market assigned: {market_assignment}")

    # validator = Validator(market_assignment)
    # validator.validate()

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