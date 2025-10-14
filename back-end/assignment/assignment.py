from typing import List, Dict, Optional, Tuple
from datatypes import (
    Market, SetupObject, MarketDateObject, TierObject, SectionObject, 
    AssignmentObject, AssignmentStatistics, VendorAssignmentResult, PriorityObject, DataType,
    LocationObject
)
import random
import math
from datetime import datetime

# Constants
FULL_TABLE_ONLY = "Full table"
EITHER_TABLE = "Either"
MAX_VENDING_DAYS = 3


class Vendor:
    """Represents a vendor with their preferences and assignments."""
    def __init__(self, email: str, row_data: List[str], col_names: List[str], market_dates: List[str]):
        self.email = email
        self.num_assignments = 0
        self.assignment: Dict[str, Optional[VendorAssignmentResult]] = {date: None for date in market_dates}
        
        # Set attributes from row data
        for i, col_name in enumerate(col_names):
            if i < len(row_data):
                setattr(self, col_name.lower().replace(' ', '_'), row_data[i])
        
        # Set default values for missing attributes
        if not hasattr(self, 'table_choice'):
            self.table_choice = EITHER_TABLE
        if not hasattr(self, 'table_share_email'):
            self.table_share_email = ""
        if not hasattr(self, 'table_choice_score'):
            self.table_choice_score = 0
        if not hasattr(self, 'priority'):
            self.priority = 0
        
        self.date_flexibility = self._calculate_date_flexibility(market_dates)

    def _calculate_date_flexibility(self, market_dates: List[str]) -> int:
        """Calculate how flexible the vendor is across dates."""
        flexibility = 0
        for date in market_dates:
            date_attr = date.lower().replace(' ', '_')
            if hasattr(self, date_attr):
                date_value = getattr(self, date_attr, '')
                if date_value and date_value != '':
                    # Count number of tiers selected for this date
                    flexibility += len(str(date_value).split(','))
        return flexibility

    def assign(self, date: str, vendor_assignment: VendorAssignmentResult):
        """Assign vendor to a table on a specific date."""
        self.assignment[date] = vendor_assignment
        self.num_assignments += 1

    def is_date_assigned(self, date: str) -> bool:
        """Check if vendor is already assigned on this date."""
        return self.assignment[date] is not None

    def is_max_assigned(self, max_assignments: int) -> bool:
        """Check if vendor has reached maximum assignments."""
        return self.num_assignments >= max_assignments

    def __repr__(self):
        return f"Vendor({self.email}, assignments={self.num_assignments})"


class Table:
    """Represents a table with its properties and assignments."""
    def __init__(self, table_code: str, section: SectionObject, tier: TierObject, location: LocationObject):
        self.table_code = table_code
        self.section = section
        self.tier = tier
        self.location = location
        self.assignment: List[Vendor] = []

    def availability(self) -> int:
        """Return number of available slots (0, 1, or 2)."""
        return 2 - len(self.assignment)

    def is_full(self) -> bool:
        """Check if table is fully assigned."""
        return len(self.assignment) >= 2

    def assign(self, vendors: List[Vendor]):
        """Assign vendors to this table."""
        self.assignment = vendors

    def __repr__(self):
        return f"Table({self.table_code}, {self.tier.name}, availability={self.availability()})"


class DateAssignment:
    """Represents table assignments for a specific market date."""
    def __init__(self, date: str, tables: List[Table]):
        self.date = date
        self.tables = tables

    def __repr__(self):
        return f"DateAssignment({self.date}, {len(self.tables)} tables)"


class MarketAssignment:
    """Main class for managing market table assignments."""
    def __init__(self, setup: SetupObject):
        self.setup = setup
        self.vendors: List[Vendor] = []
        self.date_assignments: Dict[str, DateAssignment] = {}
        self.total_tables: Dict[str, int] = {}
        self.table_sharing: List[Vendor] = []
        self.half_tables: Dict[str, Dict[str, int]] = {}
        
        self._initialize_data()

    def _initialize_data(self):
        """Initialize vendors, tables, and date assignments from setup data."""
        # Initialize vendors from colValues data
        market_dates = [md.date for md in self.setup.marketDates]
        market_tiers = [tier.name for tier in self.setup.tiers]
        
        # Find the email column index
        email_col_idx = None
        for i, col_name in enumerate(self.setup.colNames):
            if col_name.lower().replace(' ', '_') == "email_address":
                email_col_idx = i
                break
        
        if email_col_idx is None:
            raise ValueError("Email Address column not found in setup data")
        
        # Get the number of vendors (rows) from the email column
        email_column = self.setup.colValues[email_col_idx]
        num_vendors = len(email_column)
        
        # Create vendors by iterating through rows
        for row_idx in range(num_vendors):
            email = email_column[row_idx]
            if not email or email.strip() == '':
                continue  # Skip empty emails
                
            # Get row data by extracting the value at row_idx from each column
            row_data = []
            for col_values in self.setup.colValues:
                if row_idx < len(col_values):
                    row_data.append(col_values[row_idx])
                else:
                    row_data.append('')
            
            vendor = Vendor(email, row_data, self.setup.colNames, market_dates)
            self.vendors.append(vendor)

        # Track total tables per section
        for section in self.setup.sections:
            self.total_tables[section.name] = section.count

        # Initialize half_tables tracking
        for date in market_dates:
            self.half_tables[date] = {}
            for section in self.setup.sections:
                self.half_tables[date][section.name] = 0

        # Initialize date assignments
        for date in market_dates:
            # Create separate table objects for each date
            date_tables = []
            for section in self.setup.sections:
                for i in range(section.count):
                    table_code = f"{section.name}{i+1:02d}"
                    tier = section.tier
                    location = section.location
                    table = Table(table_code, section, tier, location)
                    date_tables.append(table)
            
            # Sort tables by tier for this date
            tier_order = {tier: i for i, tier in enumerate(market_tiers)}
            date_tables.sort(key=lambda t: tier_order.get(t.tier.name, 3))
            
            # Shuffle tables within each tier for randomization
            current_tier = None
            tier_start = 0
            for i, table in enumerate(date_tables):
                if table.tier.name != current_tier:
                    if current_tier is not None:
                        # Shuffle previous tier
                        random.shuffle(date_tables[tier_start:i])
                    current_tier = table.tier.name
                    tier_start = i
            # Shuffle last tier
            if current_tier is not None:
                random.shuffle(date_tables[tier_start:])
            
            self.date_assignments[date] = DateAssignment(date, date_tables)

    def _get_vendor_column_value(self, vendor: Vendor, col_name_idx: int) -> str:
        """Get the value of a specific column for a vendor."""
        if col_name_idx >= len(self.setup.colNames):
            return ""
        
        col_name = self.setup.colNames[col_name_idx]
        attr_name = col_name.lower().replace(' ', '_')
        
        if hasattr(vendor, attr_name):
            value = getattr(vendor, attr_name, '')
            return str(value) if value is not None else ""
        
        return ""

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

    def is_valid_vendor(self, vendor: Vendor, date: str, table: Table) -> bool:
        """Check if vendor can be assigned to table on date."""
        if vendor is None or vendor.is_date_assigned(date):
            return False
            
        # Check max assignments constraint
        if self.setup.assignmentOptions.maxAssignmentsPerVendor is not None:
            max_assignments = self.setup.assignmentOptions.maxAssignmentsPerVendor
            if vendor.is_max_assigned(max_assignments):
                return False

        if hasattr(vendor, 'max_days'):
            max_days = vendor.max_days
            if max_days is not None:
                # Convert to int if it's a string
                try:
                    max_days_int = int(max_days) if isinstance(max_days, str) else max_days
                    if vendor.num_assignments >= max_days_int:
                        return False
                except (ValueError, TypeError):
                    # If conversion fails, skip this check
                    pass
        
            
        # Check if vendor wants this tier on this date
        date_attr = date.lower().replace(' ', '_')
        if hasattr(vendor, date_attr):
            date_value = getattr(vendor, date_attr, '')
            if table.tier.name.lower() not in str(date_value).lower():
                return False
                
        return True

    def _get_vendor_table_choice(self, vendor: Vendor) -> str:
        """Get vendor's table choice preference."""
        table_choice_attr = "table_choice"
        if hasattr(vendor, table_choice_attr):
            choice = getattr(vendor, table_choice_attr, '')
            if choice:
                return choice.lower().replace(' ', '_')
        
        return "full_table"  # Default

    def _find_table_partner(self, vendor: Vendor, date: str, table: Table) -> Optional[Vendor]:
        """Find a partner vendor for half table assignment."""
        # Check if section has reached max half table proportion
        if self.is_max_half_tables_for_section(date, table.section.name):
            return None
        
        # Look for a partner vendor who:
        # 1. Is not the same vendor
        # 2. Is valid for this date and table
        # 3. Wants half table or either
        # 4. Has compatible preferences
        
        for potential_partner in self.vendors:
            if potential_partner.email == vendor.email:
                continue  # Skip same vendor
            
            if not self.is_valid_vendor(potential_partner, date, table):
                continue  # Skip invalid vendors
            
            partner_choice = self._get_vendor_table_choice(potential_partner)
            if partner_choice in ["half_table", "either"]:
                return potential_partner
        
        return None

    def get_valid_vendor(self, date: str, table: Table) -> Optional[Vendor]:
        """Get the next valid vendor for a table."""
        for vendor in self.vendors:
            if self.is_valid_vendor(vendor, date, table):
                return vendor
        return None

    def get_table_share_vendor(self, vendor: Vendor) -> Optional[Vendor]:
        """Get the vendor that wants to share a table with the given vendor."""
        if not vendor.table_share_email:
            return None
        
        for potential_vendor in self.vendors:
            if potential_vendor.email == vendor.table_share_email:
                return potential_vendor
        return None

    def is_max_half_tables(self, date: str, section: str) -> bool:
        """Check if section has reached max half table proportion."""
        return self.is_max_half_tables_for_section(date, section)

    def get_valid_vendors(self, date: str, table: Table) -> Optional[List[Vendor]]:
        next_vendor = self.get_valid_vendor(date, table)

        # check if no more valid vendors
        if next_vendor == None:
            return None

        # check for valid table sharing partner
        if next_vendor.table_share_email != "" and next_vendor.table_choice != FULL_TABLE_ONLY:
            table_share_vendor = self.get_table_share_vendor(next_vendor)
            if self.is_valid_vendor(table_share_vendor, date, table):
                self.table_sharing.append(next_vendor)
                self.table_sharing.append(table_share_vendor)
                return [next_vendor, table_share_vendor]

        # check if vendor selected full table only
        if next_vendor.table_choice == FULL_TABLE_ONLY:
            return [next_vendor, next_vendor]

        # check if vendor selected either and if there are max half tables for the section
        if next_vendor.table_choice == EITHER_TABLE:
            if self.is_max_half_tables(date, table.section.name):
                return [next_vendor, next_vendor]

        # half table, loop to find next vendor for other half
        valid_vendors = [next_vendor]
        for vendor in self.vendors:
            # exit loop when valid_vendors is full
            if len(valid_vendors) == 2:
                break
            
            # check: valid table tier, vendor not max assigned, vendor not assigned for date
            if not self.is_valid_vendor(vendor, date, table):
                continue

            # check not equal to next_vendor
            if vendor.email == next_vendor.email:
                continue

            # append if vendor selected half table
            if vendor.table_choice != FULL_TABLE_ONLY:
                valid_vendors.append(vendor)
        
        # If we only have one vendor and they want half table, we need a partner
        # If no partner found, return None to skip this table for now
        if len(valid_vendors) == 1 and next_vendor.table_choice == "Half table":
            return None
                
        return valid_vendors

    def is_max_half_tables_for_section(self, date: str, section: str) -> bool:
        """Check if section has reached max half table proportion."""
        max_proportion_percent = self.setup.assignmentOptions.maxHalfTableProportionPerSection or 30  # Default 30%
        max_proportion = max_proportion_percent / 100.0  # Convert percentage to decimal
        if self.total_tables[section] == 0:
            return False
        return self.half_tables[date][section] / self.total_tables[section] >= max_proportion

    def assign_table(self, date: str, vendor_list: List[Vendor], table: Table):
        """Assign vendors to a table."""
        if len(vendor_list) < 2 or vendor_list[0].email == vendor_list[1].email:
            # Full table assignment
            assignment = VendorAssignmentResult(
                email=vendor_list[0].email,
                date=date,
                tableCode=table.table_code,
                tableChoice="Full table",
                section=table.section.name,
                tier=table.tier.name,
                location=table.location.name
            )
            vendor_list[0].assign(date, assignment)
        else:
            # Half table assignment
            for i, vendor in enumerate(vendor_list):
                table_choice = "Half table - Left" if i == 0 else "Half table - Right"
                assignment = VendorAssignmentResult(
                    email=vendor.email,
                    date=date,
                    tableCode=table.table_code,
                    tableChoice=table_choice,
                    section=table.section.name,
                    tier=table.tier.name,
                    location=table.location.name
                )
                vendor.assign(date, assignment)
            self.half_tables[date][table.section.name] = self.half_tables[date].get(table.section.name, 0) + 1
        
        table.assign(vendor_list)

    def assign(self):
        """Main assignment algorithm."""
        # Loop through market dates
        for date, date_assignment in self.date_assignments.items():
            # Sort vendors by priority
            self.sort_vendors()
            
            # Loop through tables (already sorted by tier)
            for table in date_assignment.tables:
                if table.is_full():
                    continue
                    
                vendor_list = self.get_valid_vendors(date, table)
                if vendor_list is None:
                    continue
                    
                self.assign_table(date, vendor_list, table)


def assign_market(market: Market) -> Market:
    """Assign vendors to tables for a market."""
    if not market.setupObject:
        raise ValueError("Market must have setup data to perform assignment")
    
    # Create market assignment instance
    market_assignment = MarketAssignment(market.setupObject)
    
    # Run the assignment algorithm
    market_assignment.assign()
    
    # Collect assignment results
    vendor_assignments = []
    assigned_vendors = set()
    assigned_tables = set()
    
    for vendor in market_assignment.vendors:
        for date, assignment in vendor.assignment.items():
            if assignment is not None:
                vendor_assignments.append(assignment)
                assigned_vendors.add(vendor.email)
                assigned_tables.add(assignment.tableCode)
    
    # Create assignment statistics
    statistics = AssignmentStatistics(
        totalVendors=len(market_assignment.vendors),
        totalTables=sum(len(da.tables) for da in market_assignment.date_assignments.values()),
        assignmentsPerDate={
            date: len([va for va in vendor_assignments if va.date == date])
            for date in market_assignment.date_assignments.keys()
        },
        assignmentsPerTier={},
        assignmentsPerSection={},
        assignmentsPerTableChoice={}
    )
    
    # Calculate tier, section, and table choice statistics
    for assignment in vendor_assignments:
        statistics.assignmentsPerTier[assignment.tier] = statistics.assignmentsPerTier.get(assignment.tier, 0) + 1
        statistics.assignmentsPerSection[assignment.section] = statistics.assignmentsPerSection.get(assignment.section, 0) + 1
        if statistics.assignmentsPerTableChoice is not None:
            statistics.assignmentsPerTableChoice[assignment.tableChoice] = statistics.assignmentsPerTableChoice.get(assignment.tableChoice, 0) + 1
    
    # Create assignment object with results
    assignment_result = AssignmentObject(
        vendorAssignments=vendor_assignments,
        assignmentDate=datetime.now().isoformat(),
        totalVendorsAssigned=len(assigned_vendors),
        totalTablesAssigned=len(assigned_tables),
        assignmentStatistics=statistics
    )
    
    # Update the market with assignment results
    market.assignmentObject = assignment_result
    
    return market

class Validator:
    def __init__(self, market_assignment):
        self.market_assignment = market_assignment
        self.vendors = market_assignment.vendors
        self.tables = []
        self.market_dates = list(market_assignment.date_assignments.keys())
        for date_assignment in market_assignment.date_assignments.values():
            for table in date_assignment.tables:
                self.tables.append(table)

    def validate_num_assignments(self):
        for vendor in self.vendors:
            if vendor.num_assignments > MAX_VENDING_DAYS:
                print(f"Invalid num assignments:\n{vendor}")

    def validate_vendor_assignments(self):
        for vendor in self.vendors:
            for date in self.market_dates:
                vendor_assignment = vendor.assignment[date]
                
                if vendor_assignment == None:
                    continue
                    
                date_attr = date.lower().replace(' ', '_')
                vendor_tier_choices = getattr(vendor, date_attr, '')
                if len(str(vendor_tier_choices)) == 0:
                    print(f"Invalid date:\n{date}\n{vendor}")
                if vendor_assignment.tier not in str(vendor_tier_choices):
                    print(f"Invalid tier assignment:\n{vendor_assignment.tier}\n{vendor_tier_choices}\n{vendor}")
                
                # Validate table choice matches vendor preference
                self._validate_table_choice_assignment(vendor, vendor_assignment)
    
    def _validate_table_choice_assignment(self, vendor: Vendor, assignment: VendorAssignmentResult):
        """Validate that the assigned table choice matches the vendor's preference."""
        vendor_table_choice = getattr(vendor, 'table_choice', EITHER_TABLE)
        
        if vendor_table_choice == FULL_TABLE_ONLY:
            if assignment.tableChoice != "Full table":
                print(f"Invalid table choice assignment: Vendor {vendor.email} requested 'Full table only' but got '{assignment.tableChoice}'")
        elif vendor_table_choice == "Half table":
            if assignment.tableChoice not in ["Half table - Left", "Half table - Right"]:
                print(f"Invalid table choice assignment: Vendor {vendor.email} requested 'Half table' but got '{assignment.tableChoice}'")
        # "Either" can get any valid assignment, so no validation needed

    def validate_tables(self):
        for table in self.tables:
            if len(table.assignment) > 2:
                print(f"Too many at table:\n{table}")

    def validate(self):
        self.validate_num_assignments()
        self.validate_vendor_assignments()
        self.validate_tables()

    def get_unassigned_vendors(self):
        result = []
        for vendor in self.vendors:
            if vendor.num_assignments == 0:
                result.append(vendor)
        return result

    def get_unassigned_vendor_table_choices(self):
        result_dict = {}
        unassigned_vendors = self.get_unassigned_vendors()
        for vendor in unassigned_vendors:
            result_dict[vendor.table_choice] = result_dict.get(vendor.table_choice, 0) + 1
        return result_dict
        
    def get_assigned_vendors(self):
        result = []
        for vendor in self.vendors:
            if vendor.num_assignments > 0:
                result.append(vendor)
        return result

    def get_vendor_assignment_counts(self):
        return_dict = {}
        for vendor in self.vendors:
            return_dict[vendor.num_assignments] = return_dict.get(vendor.num_assignments, 0) + 1
        return_dict = dict(sorted(return_dict.items()))
        return return_dict

    def get_table_assignment_counts(self):
        return_dict = {}
        for date in self.market_dates:
            table_choice_dict = {}
            for vendor in self.vendors:
                if vendor.assignment[date] == None:
                    continue
                table_choice = vendor.assignment[date].tableChoice
                table_choice_dict[table_choice] = table_choice_dict.get(table_choice, 0) + 1
            table_choice_dict = dict(sorted(table_choice_dict.items()))
            return_dict[date] = table_choice_dict
        return return_dict

    def get_table_choice_counts(self):
        table_choice_dict = {}
        for vendor in self.vendors:
            table_choice = vendor.table_choice
            table_choice_dict[table_choice] = table_choice_dict.get(table_choice, 0) + 1
        table_choice_dict = dict(sorted(table_choice_dict.items()))
        return table_choice_dict

    def get_table_availability_counts(self):
        return_dict = {}
        for date in self.market_dates:
            tables_dict = {}
            for table in self.market_assignment.date_assignments[date].tables:
                tables_dict[table.availability()] = tables_dict.get(table.availability(), 0) + 1
            tables_dict = dict(sorted(tables_dict.items()))
            return_dict[date] = tables_dict
        return return_dict
        
    # for each market date, get number of tables needed if every vendor were to be assigned
    def get_theoretical_max(self):
        return_dict = {}
        
        for date in self.market_dates:
            for vendor in self.vendors:
                # Get the date attribute name (convert date to attribute format)
                date_attr = date.lower().replace(' ', '_')
                
                # continue if date not requested
                date_value = getattr(vendor, date_attr, '')
                if len(str(date_value)) == 0:
                    continue

                increment = 1
                if vendor.table_choice == FULL_TABLE_ONLY:
                    increment = 2
                return_dict[date] = return_dict.get(date, 0) + increment

        # convert half table count to full table
        for key in return_dict.keys():
            return_dict[key] = math.ceil(return_dict[key] / 2)
            
        return return_dict