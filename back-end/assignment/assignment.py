from typing import List, Dict
from datatypes import (
    Market, SetupObject, MarketDateObject, TierObject, SectionObject, 
    AssignmentObject, AssignmentStatistics, VendorAssignmentResult, PriorityObject, DataType,
    LocationObject
)

import random
import math
from datetime import datetime

# temporary constants
FULL_TABLE_ONLY = "Full table"
HALF_TABLE_ONLY = "Half table"
EITHER_TABLE = "Either"
NO_CLUB_MEMBERSHIP = "I am NOT a part of any of these clubs"

def toAttrString(str):
    str = str.lower()
    str = str.replace(' ', '_')
    return str



class VendorAssignment:
    def __init__(self, table_choice, table):
        self.table_choice = table_choice
        self.table = table

    def __repr__(self):
        return f"{self.table.table_code} - {self.table_choice}"



class Vendor:
    def __init__(self, entry, market_dates: List[MarketDateObject]):
        self.num_assignments = 0
        
        # initialize assignment dict from market dates
        dates = [market_date.date for market_date in market_dates]
        self.assignment = dict.fromkeys(dates, None)

        # set attributes using row of vendor dataframe
        for key, value in entry.items():
            setattr(self, toAttrString(key), value)

    def __repr__(self):
        return f"{vars(self)}"

    def assign(self, date, vendor_assignment):
        self.assignment[date] = vendor_assignment
        self.num_assignments += 1

    def is_date_assigned(self, date):
        return self.assignment[date] != None

    def is_max_assigned(self):
        return self.num_assignments >= MAX_VENDING_DAYS



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
    def __init__(self, setup_object: SetupObject):
        self.setup_object = setup_object
        self.table_sharing = []
        self.date_assignments = {}
        self.half_tables = {}

        # initialize date assignments from market dates
        for market_date in setup_object.marketDates:
            self.date_assignments[market_date.date] = DateAssignment(market_date, setup_object.sections)

        # initialize vendors from vendor data frame
        vendor_rows = self._get_vendor_rows()
        self.vendors = []
        for row_entry in vendor_rows:
            self.vendors.append(Vendor(row_entry, setup_object.marketDates))

        # initialize half tables dict
        for market_date in setup_object.marketDates:
            date = market_date.date
            self.half_tables[date] = {}
            for section in setup_object.sections:
                self.half_tables[date][section.name] = 0

    def __repr__(self):
        return f"{vars(self)}"

    def _get_column_values(self, col_name: str) -> List[str]:
        for idx, column in enumerate(self.setup_object.colNames):
            if toAttrString(column) == toAttrString(col_name):
                return self.setup_object.colValues[idx]
        raise ValueError(f"Column {col_name} not found in setup object")

    def _get_vendor_rows(self) -> List[Dict[str, str]]:
        vendor_rows = []
        for i in range(len(self.setup_object.colValues[0])):
            row = {}
            for j in range(len(self.setup_object.colNames)):
                row[self.setup_object.colNames[j]] = self.setup_object.colValues[j][i]
            vendor_rows.append(row)
        return vendor_rows

    def _calculate_priority_score(self, vendor: Vendor) -> List[int]:
        """Calculate priority scores for a vendor based on priority configuration."""
        scores = []
        
        # Sort priority items by their id (lower id = higher priority)
        sorted_priorities = sorted(self.setup.priority, key=lambda p: p.id)
        
        for priority_item in sorted_priorities:
            col_name_idx = priority_item.colNameIdx
            enum_order = self.setup.enumPriorityOrder[col_name_idx]
            
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
        date = market_date.date
        return vendor != None and table.tier in getattr(vendor, date) and not vendor.is_max_assigned() and not vendor.is_date_assigned(date)

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
        date = market_date.date
        section = section_object.name
        return self.half_tables[date][section] / self.total_tables[section] >= MAX_HALF_TABLES_PER_SECTION // TODO: FIX THIS

    def assign_table(self, market_date: MarketDateObject, vendor_list, table):
        date = market_date.date
        # full table assignment
        
        if len(vendor_list) < 2 or vendor_list[0].email == vendor_list[1].email:
            vendor_list[0].assign(market_date, VendorAssignment("Full table", table))

        # half table assignment
        else:
            for vendor in vendor_list:
                vendor.assign(market_date, VendorAssignment("Half table", table))

            
            self.half_tables[date][table.table_code[0]] = self.half_tables[date].get(table.table_code[0], 0) + 1
        
        table.assign(vendor_list)

    def manually_assign(self, market_date: MarketDateObject, vendor, table_code):
        date = market_date.date
        table = self.get_table_by_code(date, table_code)
        vendor_list = [vendor, vendor]
        vendor.assign(market_date, VendorAssignment("Full table", table))
        table.assign(vendor_list)

    def assign(self):
        # loop market dates
        for market_date, date_assignment in self.date_assignments.items():
            date = market_date.date

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


def assign_market(market: Market) -> Market:
    """Assign vendors to tables for a market."""
    if not market.setupObject:
        raise ValueError("Market must have setup data to perform assignment")
    
    # Create market assignment instance
    market_assignment = MarketAssignment(market.setupObject)
    
    # Run the assignment algorithm
    market_assignment.assign()
    market.assignmentObject = market_assignment
    return market