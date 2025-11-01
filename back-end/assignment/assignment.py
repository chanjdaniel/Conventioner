from typing import List, Dict, Any
from datatypes import (
    Market, SetupObject, MarketDateObject, TierObject, SectionObject, 
    AssignmentObject, AssignmentStatistics, VendorAssignmentResult, PriorityObject, DataType,
    LocationObject
)

import random
import math
from datetime import datetime
import traceback
import logging

from assignment.validator import Validator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# temporary constants
FULL_TABLE_ONLY = "Full table"
HALF_TABLE_ONLY = "Half table"
EITHER_TABLE = "Either"
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
        return (self.num_assignments >= MAX_VENDING_DAYS or self.num_assignments >= int(self.max_days[0])) # max_days is str, need to parse first character to int



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
    def __init__(self, setup_object: SetupObject, source_data: Dict[str, Any]):
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
        if col_name_idx >= len(self.source_data["headers"]):
            raise ValueError(f"Column index {col_name_idx} out of range for col_names: {self.setup_object.col_names}")
        col_name = self.source_data["headers"][col_name_idx]
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
            and not vendor.is_max_assigned()
            and not vendor.is_date_assigned(market_date)
        )

    def get_vendor_by_email(self, email):
        for vendor in self.vendors:
            if vendor.email == email:
                return vendor

    def get_table_by_code(self, market_date: MarketDateObject, table_code):
        date = market_date.date
        for table in self.date_assignments[date].tables:
            if table.table_code == table_code:
                return table

    # given a vendor, return with the vendor associated with table_share_email, else return None
    def get_table_share_vendor(self, vendor):
        for table_share_vendor in self.vendors:
            if vendor.table_share_email == table_share_vendor.email:
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
        if next_vendor.table_share_email != "" and next_vendor.table_choice != FULL_TABLE_ONLY:
            table_share_vendor = self.get_table_share_vendor(next_vendor)
            if self.is_valid_vendor(table_share_vendor, market_date, table):
                self.table_sharing.append(next_vendor)
                self.table_sharing.append(table_share_vendor)
                return [next_vendor, table_share_vendor]

        # check if vendor selected full table only
        if next_vendor.table_choice == FULL_TABLE_ONLY:
            return [next_vendor, next_vendor]

        # check if vendor selected either and if there are max half tables for the section
        if next_vendor.table_choice == EITHER_TABLE:
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
            if vendor.email == next_vendor.email:
                continue

            # append if vendor selected half table
            if vendor.table_choice != FULL_TABLE_ONLY:
                valid_vendors.append(vendor)
                
        return valid_vendors

    def is_max_half_tables(self, market_date: MarketDateObject, section_object: SectionObject):
        date_col_name = market_date.col_name
        section = section_object.name
        return self.half_tables[date_col_name][section] / section_object.count >= MAX_HALF_TABLES_PER_SECTION

    def assign_table(self, market_date: MarketDateObject, vendor_list, table):
        
        # full table assignment
        if len(vendor_list) < 2 or vendor_list[0].email == vendor_list[1].email:
            assignment = VendorAssignmentResult(
                email=vendor_list[0].email,
                date=market_date.col_name,
                table_code=table.table_code,
                table_choice="Full table",
                section=table.section.name,
                tier=table.tier.name,
                location=table.location.name
            )
            vendor_list[0].assign(market_date, assignment)
        else:
            # half table assignment
            for i, vendor in enumerate(vendor_list):
                table_choice = "Half table - Left" if i == 0 else "Half table - Right"
                assignment = VendorAssignmentResult(
                    email=vendor.email,
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
            email=vendor.email,
            date=market_date.col_name,
            table_code=table_code,
            table_choice="Full table",
            section=table.section.name,
            tier=table.tier.name,
            location=table.location.name
        ))
        table.assign(vendor_list)

    # TODO: finish this
    def get_assignment_statistics(self) -> AssignmentStatistics:
        vendor_assignments = []
        assigned_vendors = set()
        assigned_tables = set()
        
        # Collect all vendor assignments
        for vendor in self.vendors:
            for date, assignment in vendor.assignment.items():
                if assignment is not None:
                    vendor_assignments.append(assignment)
                    assigned_vendors.add(vendor.email)
                    assigned_tables.add(assignment.table_code)

        statistics = AssignmentStatistics(
            total_vendors=len(self.vendors),
            total_tables=sum(len(da.tables) for da in self.date_assignments.values()),
            total_assigned_vendors=len(assigned_vendors),
            total_assigned_tables=len(assigned_tables),
            unassigned_vendors=[],
            unassigned_tables={},
            assignments_per_date={},
            assignments_per_tier={},
            assignments_per_section={},
            assignments_per_table_choice={},
            satisfaction_score=0
        )

        for assignment in vendor_assignments:
            statistics.assignments_per_tier[assignment.tier] = statistics.assignments_per_tier.get(assignment.tier, 0) + 1
            statistics.assignments_per_section[assignment.section] = statistics.assignments_per_section.get(assignment.section, 0) + 1
            statistics.assignments_per_table_choice[assignment.table_choice] = statistics.assignments_per_table_choice.get(assignment.table_choice, 0) + 1
            statistics.assignments_per_date[assignment.date] = statistics.assignments_per_date.get(assignment.date, 0) + 1
            if assignment is None:
                statistics.unassigned_vendors.append(vendor)

        for date_assignment in market_assignment.date_assignments.values():
            for table in date_assignment.tables:
                if table.assignment is None:
                    statistics.unassigned_tables[date_assignment.market_date.date] = statistics.unassigned_tables.get(date_assignment.market_date.date, []).append(table.table_code)

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