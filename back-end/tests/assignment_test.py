import json
import pytest
import sys
import os
from datetime import datetime
from typing import List, Dict, Any

# Add the parent directory to the path to import our modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from assignment.assignment import (
    Vendor, Table, DateAssignment, MarketAssignment, assign_market, Validator
)
from datatypes import (
    Market, SetupObject, MarketDateObject, TierObject, SectionObject,
    LocationObject, AssignmentObject, VendorAssignmentResult, AssignmentOptionObject
)


class TestAssignment:
    """Test suite for the assignment module."""
    
    @pytest.fixture
    def sample_market_data(self):
        """Load sample market data from test file."""
        with open('tests/test_data/markets.json', 'r') as f:
            data = json.load(f)
            return data[0]  # Return first market
    
    @pytest.fixture
    def sample_market(self, sample_market_data):
        """Create a Market object from sample data."""
        setup_data = sample_market_data['setupObject']
        
        # Convert market dates
        market_dates = [
            MarketDateObject(date=md['date'], colNameIdx=md['colNameIdx'])
            for md in setup_data['marketDates']
        ]
        
        # Convert tiers
        tiers = [
            TierObject(id=tier['id'], name=tier['name'])
            for tier in setup_data['tiers']
        ]
        
        # Convert locations
        locations = [
            LocationObject(name=loc['name'])
            for loc in setup_data['locations']
        ]
        
        # Convert sections
        sections = []
        for section in setup_data['sections']:
            location = LocationObject(name=section['location']['name'])
            tier = TierObject(id=section['tier']['id'], name=section['tier']['name'])
            sections.append(SectionObject(
                name=section['name'],
                location=location,
                tier=tier,
                count=section['count']
            ))
        
        # Convert assignment options
        assignment_options = AssignmentOptionObject(
            maxAssignmentsPerVendor=setup_data['assignmentOptions']['maxAssignmentsPerVendor'],
            maxHalfTableProportionPerSection=setup_data['assignmentOptions']['maxHalfTableProportionPerSection']
        )
        
        # Create setup object
        setup = SetupObject(
            colNames=setup_data['colNames'],
            colValues=setup_data['colValues'],
            colInclude=setup_data['colInclude'],
            enumPriorityOrder=setup_data['enumPriorityOrder'],
            priority=setup_data['priority'],
            marketDates=market_dates,
            tiers=tiers,
            locations=locations,
            sections=sections,
            assignmentOptions=assignment_options
        )
        
        # Create market object
        market = Market(
            name=sample_market_data['name'],
            owner=sample_market_data['owner'],
            creationDate=sample_market_data['creationDate'],
            editors=sample_market_data['editors'],
            viewers=sample_market_data['viewers'],
            setupObject=setup,
            modificationList=[],
            assignmentObject=AssignmentObject()
        )
        
        return market
    
    @pytest.fixture
    def simple_setup(self):
        """Create a simple setup for basic testing."""
        market_dates = [
            MarketDateObject(date="2025-03-17", colNameIdx=0),
            MarketDateObject(date="2025-03-18", colNameIdx=1)
        ]
        
        tiers = [
            TierObject(id=1, name="Gold"),
            TierObject(id=2, name="Silver"),
            TierObject(id=3, name="Bronze")
        ]
        
        locations = [
            LocationObject(name="Main Hall"),
            LocationObject(name="Side Room")
        ]
        
        sections = [
            SectionObject(
                name="A",
                location=LocationObject(name="Main Hall"),
                tier=TierObject(id=1, name="Gold"),
                count=2
            ),
            SectionObject(
                name="B",
                location=LocationObject(name="Side Room"),
                tier=TierObject(id=2, name="Silver"),
                count=1
            )
        ]
        
        assignment_options = AssignmentOptionObject(
            maxAssignmentsPerVendor=2,
            maxHalfTableProportionPerSection=50  # 50% as integer
        )
        
        return SetupObject(
            colNames=["Email Address", "Full Name", "2025-03-17", "2025-03-18"],
            colValues=[
                ["vendor1@test.com", "vendor2@test.com"],
                ["John Doe", "Jane Smith"],
                ["Gold,Silver", "Silver,Bronze"],
                ["Gold", "Bronze"]
            ],
            colInclude=[True, True, True, True],
            enumPriorityOrder=[[], [], [], []],
            priority=[],
            marketDates=market_dates,
            tiers=tiers,
            locations=locations,
            sections=sections,
            assignmentOptions=assignment_options
        )


class TestVendor(TestAssignment):
    """Test the Vendor class."""
    
    def test_vendor_creation(self, simple_setup):
        """Test vendor creation with basic data."""
        market_dates = [md.date for md in simple_setup.marketDates]
        vendor = Vendor(
            email="test@example.com",
            row_data=["test@example.com", "Test User", "Gold,Silver", "Gold"],
            col_names=simple_setup.colNames,
            market_dates=market_dates
        )
        
        assert vendor.email == "test@example.com"
        assert vendor.num_assignments == 0
        assert len(vendor.assignment) == 2  # Two market dates
        assert vendor.assignment["2025-03-17"] is None
        assert vendor.assignment["2025-03-18"] is None
    
    def test_vendor_assignment(self, simple_setup):
        """Test vendor assignment functionality."""
        market_dates = [md.date for md in simple_setup.marketDates]
        vendor = Vendor(
            email="test@example.com",
            row_data=["test@example.com", "Test User", "Gold,Silver", "Gold"],
            col_names=simple_setup.colNames,
            market_dates=market_dates
        )
        
        # Create a test assignment
        assignment = VendorAssignmentResult(
            email="test@example.com",
            date="2025-03-17",
            tableCode="A01",
            tableChoice="Full table",
            section="A",
            tier="Gold",
            location="Main Hall"
        )
        
        # Test assignment
        vendor.assign("2025-03-17", assignment)
        
        assert vendor.num_assignments == 1
        assert vendor.assignment["2025-03-17"] == assignment
        assert vendor.is_date_assigned("2025-03-17") is True
        assert vendor.is_date_assigned("2025-03-18") is False
    
    def test_vendor_max_assignments(self, simple_setup):
        """Test vendor max assignments constraint."""
        market_dates = [md.date for md in simple_setup.marketDates]
        vendor = Vendor(
            email="test@example.com",
            row_data=["test@example.com", "Test User", "Gold,Silver", "Gold"],
            col_names=simple_setup.colNames,
            market_dates=market_dates
        )
        
        # Test max assignments
        assert vendor.is_max_assigned(0) is True
        assert vendor.is_max_assigned(1) is False
        
        # Assign and test again
        assignment = VendorAssignmentResult(
            email="test@example.com",
            date="2025-03-17",
            tableCode="A01",
            tableChoice="Full table",
            section="A",
            tier="Gold",
            location="Main Hall"
        )
        vendor.assign("2025-03-17", assignment)
        
        assert vendor.is_max_assigned(1) is True
        assert vendor.is_max_assigned(2) is False


class TestTable(TestAssignment):
    """Test the Table class."""
    
    def test_table_creation(self):
        """Test table creation."""
        section = SectionObject(
            name="A",
            location=LocationObject(name="Main Hall"),
            tier=TierObject(id=1, name="Gold"),
            count=2
        )
        
        table = Table(
            table_code="A01",
            section=section,
            tier=TierObject(id=1, name="Gold"),
            location=LocationObject(name="Main Hall")
        )
        
        assert table.table_code == "A01"
        assert table.section.name == "A"
        assert table.tier.name == "Gold"
        assert table.location.name == "Main Hall"
        assert table.availability() == 2
        assert table.is_full() is False
    
    def test_table_assignment(self):
        """Test table assignment functionality."""
        section = SectionObject(
            name="A",
            location=LocationObject(name="Main Hall"),
            tier=TierObject(id=1, name="Gold"),
            count=2
        )
        
        table = Table(
            table_code="A01",
            section=section,
            tier=TierObject(id=1, name="Gold"),
            location=LocationObject(name="Main Hall")
        )
        
        # Create mock vendors
        market_dates = ["2025-03-17", "2025-03-18"]
        vendor1 = Vendor("vendor1@test.com", ["vendor1@test.com", "Vendor 1"], ["email", "name"], market_dates)
        vendor2 = Vendor("vendor2@test.com", ["vendor2@test.com", "Vendor 2"], ["email", "name"], market_dates)
        
        # Test assignment
        table.assign([vendor1, vendor2])
        
        assert len(table.assignment) == 2
        assert table.availability() == 0
        assert table.is_full() is True


class TestMarketAssignment(TestAssignment):
    """Test the MarketAssignment class."""
    
    def test_market_assignment_initialization(self, simple_setup):
        """Test market assignment initialization."""
        market_assignment = MarketAssignment(simple_setup)
        
        assert len(market_assignment.vendors) == 2  # Two vendors in simple setup
        assert len(market_assignment.date_assignments) == 2  # Two market dates
        assert len(market_assignment.total_tables) == 2  # Two sections
        
        # Check vendor emails
        vendor_emails = [vendor.email for vendor in market_assignment.vendors]
        assert "vendor1@test.com" in vendor_emails
        assert "vendor2@test.com" in vendor_emails
    
    def test_table_creation_and_sorting(self, simple_setup):
        """Test that tables are created and sorted correctly."""
        market_assignment = MarketAssignment(simple_setup)
        
        # Get tables from first date assignment
        first_date = list(market_assignment.date_assignments.keys())[0]
        tables = market_assignment.date_assignments[first_date].tables
        
        # Should have 3 tables total (2 from section A, 1 from section B)
        assert len(tables) == 3
        
        # Tables should be sorted by tier (Gold first, then Silver)
        assert tables[0].tier.name == "Gold"  # Section A tables
        assert tables[1].tier.name == "Gold"  # Section A tables
        assert tables[2].tier.name == "Silver"  # Section B tables
    
    def test_vendor_sorting(self, simple_setup):
        """Test vendor sorting functionality."""
        market_assignment = MarketAssignment(simple_setup)
        
        # Sort vendors
        market_assignment.sort_vendors()
        
        # Should still have all vendors
        assert len(market_assignment.vendors) == 2
    
    def test_valid_vendor_check(self, simple_setup):
        """Test vendor validation logic."""
        market_assignment = MarketAssignment(simple_setup)
        
        # Get first vendor and first table
        vendor = market_assignment.vendors[0]
        first_date = list(market_assignment.date_assignments.keys())[0]
        table = market_assignment.date_assignments[first_date].tables[0]
        
        # Test valid vendor check
        is_valid = market_assignment.is_valid_vendor(vendor, first_date, table)
        assert isinstance(is_valid, bool)
    
    def test_assignment_algorithm(self, simple_setup):
        """Test the main assignment algorithm."""
        market_assignment = MarketAssignment(simple_setup)
        
        # Run assignment
        market_assignment.assign()
        
        # Check that some assignments were made
        assigned_vendors = 0
        for vendor in market_assignment.vendors:
            for date, assignment in vendor.assignment.items():
                if assignment is not None:
                    assigned_vendors += 1
        
        # Should have made some assignments
        assert assigned_vendors > 0


class TestAssignMarket(TestAssignment):
    """Test the main assign_market function."""
    
    def test_assign_market_with_simple_setup(self, simple_setup):
        """Test assign_market function with simple setup."""
        # Create a simple market
        market = Market(
            name="Test Market",
            owner="test@example.com",
            creationDate="2025-01-01T00:00:00Z",
            editors=["test@example.com"],
            viewers=[],
            setupObject=simple_setup,
            modificationList=[],
            assignmentObject=AssignmentObject()
        )
        
        # Run assignment
        result_market = assign_market(market)
        
        # Check that assignment object was populated
        assert result_market.assignmentObject is not None
        assert result_market.assignmentObject.assignmentDate != ""
        assert result_market.assignmentObject.totalVendorsAssigned >= 0
        assert result_market.assignmentObject.totalTablesAssigned >= 0
        
        # Check that statistics were created
        assert result_market.assignmentObject.assignmentStatistics.totalVendors >= 0
        assert result_market.assignmentObject.assignmentStatistics.totalTables >= 0
        assert len(result_market.assignmentObject.assignmentStatistics.assignmentsPerDate) >= 0
    
    def test_assign_market_with_sample_data(self, sample_market):
        """Test assign_market function with real sample data."""
        # Run assignment
        result_market = assign_market(sample_market)
        
        # Check that assignment object was populated
        assert result_market.assignmentObject is not None
        assert result_market.assignmentObject.assignmentDate != ""
        
        # Check that we have vendor assignments
        assert len(result_market.assignmentObject.vendorAssignments) >= 0
        
        # Check statistics
        stats = result_market.assignmentObject.assignmentStatistics
        assert stats.totalVendors > 0
        assert stats.totalTables > 0
        assert len(stats.assignmentsPerDate) == len(sample_market.setupObject.marketDates)
    
    def test_assign_market_without_setup(self):
        """Test assign_market function with market that has no setup."""
        market = Market(
            name="Test Market",
            owner="test@example.com",
            creationDate="2025-01-01T00:00:00Z",
            editors=["test@example.com"],
            viewers=[],
            setupObject=None,
            modificationList=[],
            assignmentObject=AssignmentObject()
        )
        
        # Should raise ValueError
        with pytest.raises(ValueError, match="Market must have setup data"):
            assign_market(market)


class TestTableChoiceValidation(TestAssignment):
    """Test that vendors only get assigned table choices they specified as valid."""
    
    def test_full_table_only_vendor_never_gets_half_table(self):
        """Test that vendors with 'Full table only' preference never get half table assignments."""
        # Create setup with one vendor who wants full table only
        setup = SetupObject(
            colNames=["Email Address", "Full Name", "Table Choice", "2025-03-17"],
            colValues=[
                ["vendor1@test.com", "vendor2@test.com", "vendor3@test.com"],
                ["John Doe", "Jane Smith", "Bob Wilson"],
                ["Full table only", "Either", "Half table"],
                ["Gold", "Gold", "Gold"]
            ],
            colInclude=[True, True, True, True],
            enumPriorityOrder=[[], [], [], []],
            priority=[],
            marketDates=[MarketDateObject(date="2025-03-17", colNameIdx=3)],
            tiers=[TierObject(id=1, name="Gold")],
            locations=[LocationObject(name="Main Hall")],
            sections=[SectionObject(
                name="A",
                location=LocationObject(name="Main Hall"),
                tier=TierObject(id=1, name="Gold"),
                count=2  # 2 tables = 4 half table slots
            )],
            assignmentOptions=AssignmentOptionObject(maxAssignmentsPerVendor=1, maxHalfTableProportionPerSection=100)
        )
        
        market = Market(
            name="Test Market",
            owner="test@example.com",
            creationDate="2025-01-01T00:00:00Z",
            editors=["test@example.com"],
            viewers=[],
            setupObject=setup,
            modificationList=[],
            assignmentObject=AssignmentObject()
        )
        
        result_market = assign_market(market)
        
        # Check that vendor1 (Full table only) never gets half table assignment
        vendor1_assignments = [a for a in result_market.assignmentObject.vendorAssignments if a.email == "vendor1@test.com"]
        
        for assignment in vendor1_assignments:
            assert assignment.tableChoice == "Full table", f"Vendor with 'Full table only' preference got {assignment.tableChoice} assignment"
    
    def test_half_table_vendor_never_gets_full_table(self):
        """Test that vendors with 'Half table' preference never get full table assignments."""
        # Create setup with one vendor who wants half table only
        setup = SetupObject(
            colNames=["Email Address", "Full Name", "Table Choice", "2025-03-17"],
            colValues=[
                ["vendor1@test.com", "vendor2@test.com"],
                ["John Doe", "Jane Smith"],
                ["Half table", "Full table only"],
                ["Gold", "Gold"]
            ],
            colInclude=[True, True, True, True],
            enumPriorityOrder=[[], [], [], []],
            priority=[],
            marketDates=[MarketDateObject(date="2025-03-17", colNameIdx=3)],
            tiers=[TierObject(id=1, name="Gold")],
            locations=[LocationObject(name="Main Hall")],
            sections=[SectionObject(
                name="A",
                location=LocationObject(name="Main Hall"),
                tier=TierObject(id=1, name="Gold"),
                count=1  # Only 1 table, so half table vendor should get half, full table vendor should get full
            )],
            assignmentOptions=AssignmentOptionObject(maxAssignmentsPerVendor=1, maxHalfTableProportionPerSection=100)
        )
        
        market = Market(
            name="Test Market",
            owner="test@example.com",
            creationDate="2025-01-01T00:00:00Z",
            editors=["test@example.com"],
            viewers=[],
            setupObject=setup,
            modificationList=[],
            assignmentObject=AssignmentObject()
        )
        
        result_market = assign_market(market)
        
        # Check that vendor1 (Half table) never gets full table assignment
        vendor1_assignments = [a for a in result_market.assignmentObject.vendorAssignments if a.email == "vendor1@test.com"]
        
        for assignment in vendor1_assignments:
            assert assignment.tableChoice in ["Half table - Left", "Half table - Right"], f"Vendor with 'Half table' preference got {assignment.tableChoice} assignment"
    
    def test_either_choice_vendor_gets_any_valid_assignment(self):
        """Test that vendors with 'Either' preference can get any valid table choice assignment."""
        # Create setup with vendors who want different preferences
        setup = SetupObject(
            colNames=["Email Address", "Full Name", "Table Choice", "2025-03-17"],
            colValues=[
                ["vendor1@test.com", "vendor2@test.com", "vendor3@test.com"],
                ["John Doe", "Jane Smith", "Bob Wilson"],
                ["Either", "Either", "Either"],
                ["Gold", "Gold", "Gold"]
            ],
            colInclude=[True, True, True, True],
            enumPriorityOrder=[[], [], [], []],
            priority=[],
            marketDates=[MarketDateObject(date="2025-03-17", colNameIdx=3)],
            tiers=[TierObject(id=1, name="Gold")],
            locations=[LocationObject(name="Main Hall")],
            sections=[SectionObject(
                name="A",
                location=LocationObject(name="Main Hall"),
                tier=TierObject(id=1, name="Gold"),
                count=2  # 2 tables = 4 half table slots, should accommodate all vendors
            )],
            assignmentOptions=AssignmentOptionObject(maxAssignmentsPerVendor=1, maxHalfTableProportionPerSection=100)
        )
        
        market = Market(
            name="Test Market",
            owner="test@example.com",
            creationDate="2025-01-01T00:00:00Z",
            editors=["test@example.com"],
            viewers=[],
            setupObject=setup,
            modificationList=[],
            assignmentObject=AssignmentObject()
        )
        
        result_market = assign_market(market)
        
        # Check that all vendors got valid assignments
        all_assignments = result_market.assignmentObject.vendorAssignments
        valid_table_choices = ["Full table", "Half table - Left", "Half table - Right"]
        
        for assignment in all_assignments:
            assert assignment.tableChoice in valid_table_choices, f"Vendor got invalid table choice: {assignment.tableChoice}"
    
    def test_section_half_table_limit_enforcement(self):
        """Test that section half table proportion limits are respected."""
        # Create setup with many vendors who want half tables, but limit half tables to 50%
        setup = SetupObject(
            colNames=["Email Address", "Full Name", "Table Choice", "2025-03-17"],
            colValues=[
                ["vendor1@test.com", "vendor2@test.com", "vendor3@test.com", "vendor4@test.com"],
                ["John Doe", "Jane Smith", "Bob Wilson", "Alice Brown"],
                ["Half table", "Half table", "Half table", "Full table only"],
                ["Gold", "Gold", "Gold", "Gold"]
            ],
            colInclude=[True, True, True, True],
            enumPriorityOrder=[[], [], [], []],
            priority=[],
            marketDates=[MarketDateObject(date="2025-03-17", colNameIdx=3)],
            tiers=[TierObject(id=1, name="Gold")],
            locations=[LocationObject(name="Main Hall")],
            sections=[SectionObject(
                name="A",
                location=LocationObject(name="Main Hall"),
                tier=TierObject(id=1, name="Gold"),
                count=2  # 2 tables = 4 total slots
            )],
            assignmentOptions=AssignmentOptionObject(maxAssignmentsPerVendor=1, maxHalfTableProportionPerSection=50)  # 50% max half tables
        )
        
        market = Market(
            name="Test Market",
            owner="test@example.com",
            creationDate="2025-01-01T00:00:00Z",
            editors=["test@example.com"],
            viewers=[],
            setupObject=setup,
            modificationList=[],
            assignmentObject=AssignmentObject()
        )
        
        result_market = assign_market(market)
        
        # Count half table assignments in section A
        section_a_assignments = [a for a in result_market.assignmentObject.vendorAssignments if a.section == "A"]
        half_table_assignments = [a for a in section_a_assignments if a.tableChoice in ["Half table - Left", "Half table - Right"]]
        
        # With 2 tables (4 slots) and 50% max half tables, we should have at most 2 half table assignments
        assert len(half_table_assignments) <= 2, f"Too many half table assignments: {len(half_table_assignments)} (max should be 2)"
    
    def test_mixed_table_choices_with_constraints(self):
        """Test complex scenario with mixed table choices and section constraints."""
        # Create setup with various table choice preferences
        setup = SetupObject(
            colNames=["Email Address", "Full Name", "Table Choice", "2025-03-17"],
            colValues=[
                ["vendor1@test.com", "vendor2@test.com", "vendor3@test.com", "vendor4@test.com", "vendor5@test.com"],
                ["John Doe", "Jane Smith", "Bob Wilson", "Alice Brown", "Charlie Davis"],
                ["Full table only", "Half table", "Either", "Either", "Full table only"],
                ["Gold", "Gold", "Gold", "Gold", "Gold"]
            ],
            colInclude=[True, True, True, True, True],
            enumPriorityOrder=[[], [], [], []],
            priority=[],
            marketDates=[MarketDateObject(date="2025-03-17", colNameIdx=3)],
            tiers=[TierObject(id=1, name="Gold")],
            locations=[LocationObject(name="Main Hall")],
            sections=[SectionObject(
                name="A",
                location=LocationObject(name="Main Hall"),
                tier=TierObject(id=1, name="Gold"),
                count=3  # 3 tables = 6 total slots
            )],
            assignmentOptions=AssignmentOptionObject(maxAssignmentsPerVendor=1, maxHalfTableProportionPerSection=33)  # 33% max half tables
        )
        
        market = Market(
            name="Test Market",
            owner="test@example.com",
            creationDate="2025-01-01T00:00:00Z",
            editors=["test@example.com"],
            viewers=[],
            setupObject=setup,
            modificationList=[],
            assignmentObject=AssignmentObject()
        )
        
        result_market = assign_market(market)
        
        # Validate all assignments respect vendor preferences
        assignments = result_market.assignmentObject.vendorAssignments
        
        for assignment in assignments:
            vendor_email = assignment.email
            
            # Find the vendor's table choice preference
            vendor_index = setup.colValues[0].index(vendor_email)
            vendor_table_choice = setup.colValues[2][vendor_index]
            
            # Validate assignment matches preference
            if vendor_table_choice == "Full table only":
                assert assignment.tableChoice == "Full table", f"Vendor {vendor_email} with 'Full table only' got {assignment.tableChoice}"
            elif vendor_table_choice == "Half table":
                assert assignment.tableChoice in ["Half table - Left", "Half table - Right"], f"Vendor {vendor_email} with 'Half table' got {assignment.tableChoice}"
            # "Either" can get any valid assignment, so no assertion needed
        
        # Check section constraint (33% max half tables with 3 tables = max 2 half table assignments)
        section_a_assignments = [a for a in assignments if a.section == "A"]
        half_table_assignments = [a for a in section_a_assignments if a.tableChoice in ["Half table - Left", "Half table - Right"]]
        
        assert len(half_table_assignments) <= 2, f"Section half table limit exceeded: {len(half_table_assignments)} half table assignments (max should be 2)"
    
    def test_table_choice_validation_with_validator(self):
        """Test that the validator catches invalid table choice assignments."""
        # Create a market assignment manually with invalid assignments
        setup = SetupObject(
            colNames=["Email Address", "Full Name", "Table Choice", "2025-03-17"],
            colValues=[
                ["vendor1@test.com", "vendor2@test.com"],
                ["John Doe", "Jane Smith"],
                ["Full table only", "Half table"],
                ["Gold", "Gold"]
            ],
            colInclude=[True, True, True, True],
            enumPriorityOrder=[[], [], [], []],
            priority=[],
            marketDates=[MarketDateObject(date="2025-03-17", colNameIdx=3)],
            tiers=[TierObject(id=1, name="Gold")],
            locations=[LocationObject(name="Main Hall")],
            sections=[SectionObject(
                name="A",
                location=LocationObject(name="Main Hall"),
                tier=TierObject(id=1, name="Gold"),
                count=1
            )],
            assignmentOptions=AssignmentOptionObject()
        )
        
        market_assignment = MarketAssignment(setup)
        
        # Manually create invalid assignments
        vendor1 = market_assignment.vendors[0]  # Should be "Full table only"
        vendor2 = market_assignment.vendors[1]  # Should be "Half table"
        
        # Create invalid assignments
        invalid_assignment1 = VendorAssignmentResult(
            email=vendor1.email,
            date="2025-03-17",
            tableCode="A01",
            tableChoice="Half table - Left",  # INVALID: Full table only vendor got half table
            section="A",
            tier="Gold",
            location="Main Hall"
        )
        
        invalid_assignment2 = VendorAssignmentResult(
            email=vendor2.email,
            date="2025-03-17",
            tableCode="A02",
            tableChoice="Full table",  # INVALID: Half table vendor got full table
            section="A",
            tier="Gold",
            location="Main Hall"
        )
        
        # Assign the invalid assignments
        vendor1.assign("2025-03-17", invalid_assignment1)
        vendor2.assign("2025-03-17", invalid_assignment2)
        
        # Create validator and test
        validator = Validator(market_assignment)
        
        # Capture print output to verify validation messages
        import io
        import contextlib
        
        f = io.StringIO()
        with contextlib.redirect_stdout(f):
            validator.validate_vendor_assignments()
        
        output = f.getvalue()
        
        # Check that the validator caught the invalid table choice assignments
        assert "Invalid table choice assignment" in output, f"Expected validation error for invalid table choice, but got: {output}"
        assert "requested 'Full table only' but got 'Half table - Left'" in output, f"Expected specific error message, but got: {output}"
        assert "requested 'Half table' but got 'Full table'" in output, f"Expected specific error message, but got: {output}"


class TestEdgeCases(TestAssignment):
    """Test edge cases and error handling."""
    
    def test_empty_vendor_list(self):
        """Test assignment with no vendors."""
        setup = SetupObject(
            colNames=["Email Address"],
            colValues=[[]],  # Empty vendor list
            colInclude=[True],
            enumPriorityOrder=[[]],
            priority=[],
            marketDates=[MarketDateObject(date="2025-03-17", colNameIdx=0)],
            tiers=[TierObject(id=1, name="Gold")],
            locations=[LocationObject(name="Main Hall")],
            sections=[SectionObject(
                name="A",
                location=LocationObject(name="Main Hall"),
                tier=TierObject(id=1, name="Gold"),
                count=1
            )],
            assignmentOptions=AssignmentOptionObject()
        )
        
        market_assignment = MarketAssignment(setup)
        market_assignment.assign()
        
        # Should complete without errors
        assert len(market_assignment.vendors) == 0
    
    def test_no_tables(self):
        """Test assignment with no tables."""
        setup = SetupObject(
            colNames=["Email Address"],
            colValues=[["vendor1@test.com"]],
            colInclude=[True],
            enumPriorityOrder=[[]],
            priority=[],
            marketDates=[MarketDateObject(date="2025-03-17", colNameIdx=0)],
            tiers=[TierObject(id=1, name="Gold")],
            locations=[LocationObject(name="Main Hall")],
            sections=[],  # No sections = no tables
            assignmentOptions=AssignmentOptionObject()
        )
        
        market_assignment = MarketAssignment(setup)
        market_assignment.assign()
        
        # Should complete without errors
        assert len(market_assignment.vendors) == 1
        assert len(market_assignment.date_assignments["2025-03-17"].tables) == 0
    
    def test_single_vendor_single_table(self):
        """Test assignment with one vendor and one table."""
        setup = SetupObject(
            colNames=["Email Address", "2025-03-17"],
            colValues=[["vendor1@test.com"], ["Gold"]],
            colInclude=[True, True],
            enumPriorityOrder=[[], []],
            priority=[],
            marketDates=[MarketDateObject(date="2025-03-17", colNameIdx=1)],
            tiers=[TierObject(id=1, name="Gold")],
            locations=[LocationObject(name="Main Hall")],
            sections=[SectionObject(
                name="A",
                location=LocationObject(name="Main Hall"),
                tier=TierObject(id=1, name="Gold"),
                count=1
            )],
            assignmentOptions=AssignmentOptionObject(maxAssignmentsPerVendor=1)
        )
        
        market = Market(
            name="Test Market",
            owner="test@example.com",
            creationDate="2025-01-01T00:00:00Z",
            editors=["test@example.com"],
            viewers=[],
            setupObject=setup,
            modificationList=[],
            assignmentObject=AssignmentObject()
        )
        
        result_market = assign_market(market)
        
        # Should have one assignment
        assert result_market.assignmentObject.totalVendorsAssigned == 1
        assert result_market.assignmentObject.totalTablesAssigned == 1
        assert len(result_market.assignmentObject.vendorAssignments) == 1
        
        # Check assignment details
        assignment = result_market.assignmentObject.vendorAssignments[0]
        assert assignment.email == "vendor1@test.com"
        assert assignment.date == "2025-03-17"
        assert assignment.tableChoice in ["Full table", "Half table - Left", "Half table - Right"]

    def test_priority_sorting(self):
        """Test that vendors are sorted correctly based on priority configuration."""
        from datatypes import PriorityObject, DataType
        
        # Create a simple setup with priority configuration
        setup = SetupObject(
            colNames=["email_address", "Student Status", "Club Membership"],
            colValues=[
                ["vendor1@test.com", "vendor2@test.com", "vendor3@test.com"],
                ["Yes, I am a CURRENT UBC student", "Yes, I am an UBC alumni/staff", "Yes, I am a CURRENT UBC student"],
                ["I am NOT a part of any of these clubs", "<All others>", "I am NOT a part of any of these clubs"]
            ],
            colInclude=[True, True, True],
            enumPriorityOrder=[
                [],  # Email column (index 0)
                [    # Student Status column (index 1)
                    "Yes, I am a CURRENT UBC student",
                    "Yes, I am an UBC alumni/staff"
                ],
                [    # Club Membership column (index 2)
                    "I am NOT a part of any of these clubs",
                    "<All others>"
                ]
            ],
            priority=[
                PriorityObject(id=1, colNameIdx=2, dataType=DataType.ENUM, sortingOrder=""),  # Club Membership first
                PriorityObject(id=2, colNameIdx=1, dataType=DataType.ENUM, sortingOrder="")   # Student Status second
            ],
            marketDates=[MarketDateObject(date="2025-03-17", colNameIdx=0)],
            tiers=[TierObject(id=1, name="Premium")],
            locations=[LocationObject(name="Main Hall")],
            sections=[SectionObject(name="A", location=LocationObject(name="Main Hall"), tier=TierObject(id=1, name="Premium"), count=1)],
            assignmentOptions=AssignmentOptionObject()
        )
        
        # Create market assignment
        market_assignment = MarketAssignment(setup)
        
        # Verify we have 3 vendors
        assert len(market_assignment.vendors) == 3
        
        # Sort vendors
        market_assignment.sort_vendors()
        
        # Check that vendors are sorted correctly:
        # 1. First priority: Club Membership - "I am NOT a part of any of these clubs" should come first
        # 2. Second priority: Student Status - "Yes, I am a CURRENT UBC student" should come before "Yes, I am an UBC alumni/staff"
        
        # Expected order:
        # vendor1: "I am NOT a part of any of these clubs" + "Yes, I am a CURRENT UBC student" (score: [0, 0])
        # vendor3: "I am NOT a part of any of these clubs" + "Yes, I am a CURRENT UBC student" (score: [0, 0])
        # vendor2: "<All others>" + "Yes, I am an UBC alumni/staff" (score: [1, 1])
        
        # The first two vendors should have "I am NOT a part of any of these clubs"
        assert market_assignment.vendors[0].club_membership == "I am NOT a part of any of these clubs"
        assert market_assignment.vendors[1].club_membership == "I am NOT a part of any of these clubs"
        
        # The third vendor should have "<All others>"
        assert market_assignment.vendors[2].club_membership == "<All others>"
        
        # Among the first two (same club membership), they should be sorted by student status
        # Both should be "Yes, I am a CURRENT UBC student" so order doesn't matter for this test


class TestValidator(TestAssignment):
    """Test the Validator class."""
    
    def test_validator_initialization(self, simple_setup):
        """Test validator initialization."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        
        assert len(validator.vendors) == 2
        assert len(validator.market_dates) == 2
        assert len(validator.tables) == 6  # 2 from section A, 1 from section B, across 2 dates
        assert "2025-03-17" in validator.market_dates
        assert "2025-03-18" in validator.market_dates
    
    def test_validate_num_assignments(self, simple_setup):
        """Test validation of number of assignments."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        
        # This should not raise any errors for valid assignments
        validator.validate_num_assignments()
        
        # Manually create a vendor with too many assignments
        if market_assignment.vendors:
            vendor = market_assignment.vendors[0]
            # Force set num_assignments to exceed MAX_VENDING_DAYS (3)
            vendor.num_assignments = 4
            
            # Capture print output to verify validation message
            import io
            import contextlib
            
            f = io.StringIO()
            with contextlib.redirect_stdout(f):
                validator.validate_num_assignments()
            
            output = f.getvalue()
            assert "Invalid num assignments" in output
    
    def test_validate_vendor_assignments(self, simple_setup):
        """Test validation of vendor assignments."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        
        # This should not raise any errors for valid assignments
        validator.validate_vendor_assignments()
        
        # Manually create an invalid assignment
        if market_assignment.vendors:
            vendor = market_assignment.vendors[0]
            
            # Create an assignment with wrong tier
            invalid_assignment = VendorAssignmentResult(
                email=vendor.email,
                date="2025-03-17",
                tableCode="A01",
                tableChoice="Full table",
                section="A",
                tier="Bronze",  # Invalid if vendor only wants Gold,Silver
                location="Main Hall"
            )
            
            # Assign the invalid assignment
            vendor.assign("2025-03-17", invalid_assignment)
            
            # Capture print output to verify validation message
            import io
            import contextlib
            
            f = io.StringIO()
            with contextlib.redirect_stdout(f):
                validator.validate_vendor_assignments()
            
            output = f.getvalue()
            assert "Invalid tier assignment" in output
    
    def test_validate_tables(self, simple_setup):
        """Test validation of table assignments."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        
        # This should not raise any errors for valid table assignments
        validator.validate_tables()
        
        # Manually create a table with too many assignments
        if validator.tables:
            table = validator.tables[0]
            # Force add more than 2 vendors to a table
            market_dates = ["2025-03-17", "2025-03-18"]
            vendor1 = Vendor("test1@test.com", ["test1@test.com", "Test 1"], ["email", "name"], market_dates)
            vendor2 = Vendor("test2@test.com", ["test2@test.com", "Test 2"], ["email", "name"], market_dates)
            vendor3 = Vendor("test3@test.com", ["test3@test.com", "Test 3"], ["email", "name"], market_dates)
            
            table.assign([vendor1, vendor2, vendor3])  # 3 vendors on one table
            
            # Capture print output to verify validation message
            import io
            import contextlib
            
            f = io.StringIO()
            with contextlib.redirect_stdout(f):
                validator.validate_tables()
            
            output = f.getvalue()
            assert "Too many at table" in output
    
    def test_get_unassigned_vendors(self, simple_setup):
        """Test getting unassigned vendors."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        unassigned = validator.get_unassigned_vendors()
        
        # All vendors should be assigned in our simple setup
        assert len(unassigned) == 0
        
        # Manually unassign a vendor
        if market_assignment.vendors:
            vendor = market_assignment.vendors[0]
            vendor.num_assignments = 0
            vendor.assignment = {date: None for date in validator.market_dates}
            
            unassigned = validator.get_unassigned_vendors()
            assert len(unassigned) == 1
            assert unassigned[0].email == vendor.email
    
    def test_get_assigned_vendors(self, simple_setup):
        """Test getting assigned vendors."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        assigned = validator.get_assigned_vendors()
        
        # All vendors should be assigned in our simple setup
        assert len(assigned) == 2
        
        # Check that all assigned vendors have assignments
        for vendor in assigned:
            assert vendor.num_assignments > 0
    
    def test_get_vendor_assignment_counts(self, simple_setup):
        """Test getting vendor assignment counts."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        counts = validator.get_vendor_assignment_counts()
        
        # Should be a dictionary with assignment counts as keys
        assert isinstance(counts, dict)
        
        # All values should be positive integers
        for count, num_vendors in counts.items():
            assert isinstance(count, int)
            assert isinstance(num_vendors, int)
            assert num_vendors > 0
    
    def test_get_table_choice_counts(self, simple_setup):
        """Test getting table choice counts."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        counts = validator.get_table_choice_counts()
        
        # Should be a dictionary with table choices as keys
        assert isinstance(counts, dict)
        
        # All values should be positive integers
        for choice, count in counts.items():
            assert isinstance(choice, str)
            assert isinstance(count, int)
            assert count > 0
    
    def test_get_table_assignment_counts(self, simple_setup):
        """Test getting table assignment counts per date."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        counts = validator.get_table_assignment_counts()
        
        # Should be a dictionary with dates as keys
        assert isinstance(counts, dict)
        assert len(counts) == 2  # Two market dates
        
        # Each date should have table choice counts
        for date, choice_counts in counts.items():
            assert date in validator.market_dates
            assert isinstance(choice_counts, dict)
    
    def test_get_table_availability_counts(self, simple_setup):
        """Test getting table availability counts."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        availability = validator.get_table_availability_counts()
        
        # Should be a dictionary with dates as keys
        assert isinstance(availability, dict)
        assert len(availability) == 2  # Two market dates
        
        # Each date should have availability counts
        for date, avail_counts in availability.items():
            assert date in validator.market_dates
            assert isinstance(avail_counts, dict)
            
            # Availability should be 0, 1, or 2
            for avail, count in avail_counts.items():
                assert avail in [0, 1, 2]
                assert isinstance(count, int)
                assert count >= 0
    
    def test_get_theoretical_max(self, simple_setup):
        """Test getting theoretical maximum tables needed."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        theoretical_max = validator.get_theoretical_max()
        
        # Should be a dictionary with dates as keys
        assert isinstance(theoretical_max, dict)
        assert len(theoretical_max) == 2  # Two market dates
        
        # Each date should have a positive integer value
        for date, max_tables in theoretical_max.items():
            assert date in validator.market_dates
            assert isinstance(max_tables, int)
            assert max_tables >= 0
    
    def test_get_unassigned_vendor_table_choices(self, simple_setup):
        """Test getting table choices of unassigned vendors."""
        market_assignment = MarketAssignment(simple_setup)
        market_assignment.assign()
        
        validator = Validator(market_assignment)
        
        # Initially all vendors should be assigned
        choices = validator.get_unassigned_vendor_table_choices()
        assert len(choices) == 0
        
        # Manually unassign a vendor and test
        if market_assignment.vendors:
            vendor = market_assignment.vendors[0]
            vendor.num_assignments = 0
            vendor.assignment = {date: None for date in validator.market_dates}
            
            choices = validator.get_unassigned_vendor_table_choices()
            assert len(choices) == 1
            assert vendor.table_choice in choices
            assert choices[vendor.table_choice] == 1
    
    def test_validator_with_complex_setup(self, sample_market):
        """Test validator with complex sample market data."""
        # Run assignment on sample market
        result_market = assign_market(sample_market)
        
        # Create market assignment from the result
        market_assignment = MarketAssignment(result_market.setupObject)
        
        # Manually set the assignments from the result
        for assignment in result_market.assignmentObject.vendorAssignments:
            # Find the vendor
            vendor = None
            for v in market_assignment.vendors:
                if v.email == assignment.email:
                    vendor = v
                    break
            
            if vendor:
                vendor.assign(assignment.date, assignment)
        
        # Create validator and test
        validator = Validator(market_assignment)
        
        # Run all validation methods
        validator.validate()
        
        # Test all getter methods
        unassigned = validator.get_unassigned_vendors()
        assigned = validator.get_assigned_vendors()
        vendor_counts = validator.get_vendor_assignment_counts()
        table_choice_counts = validator.get_table_choice_counts()
        table_assignment_counts = validator.get_table_assignment_counts()
        table_availability = validator.get_table_availability_counts()
        theoretical_max = validator.get_theoretical_max()
        unassigned_choices = validator.get_unassigned_vendor_table_choices()
        
        # Verify all methods return expected types
        assert isinstance(unassigned, list)
        assert isinstance(assigned, list)
        assert isinstance(vendor_counts, dict)
        assert isinstance(table_choice_counts, dict)
        assert isinstance(table_assignment_counts, dict)
        assert isinstance(table_availability, dict)
        assert isinstance(theoretical_max, dict)
        assert isinstance(unassigned_choices, dict)
        
        # Verify we have some assigned vendors
        assert len(assigned) > 0


if __name__ == "__main__":
    pytest.main([__file__])
