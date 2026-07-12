"""Regression: assignment uses assignment_options column indices for vendor semantics."""
import copy
import pytest
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from assignment.assignment import assign_market, MarketAssignment, _validate_assignment_column_mappings
from datatypes import (
    DataType,
    Market,
    MarketRole,
    PriorityObject,
    SetupObject,
    MarketDateObject,
    TierObject,
    LocationObject,
    SectionObject,
    AssignmentOptionObject,
    AssignmentObject,
)


@pytest.fixture
def mapping_setup_and_source():
    """Column labels mapped by index (no fixed attribute names)."""
    col_names = [
        "Contact",
        "Display Name",
        "FullOrHalf",
        "Buddy email",
        "MaxDaysCol",
        "2025-03-17",
    ]
    market_dates = [
        MarketDateObject(date="2025-03-17", col_name_idx=5),
    ]
    tiers = [TierObject(id=1, name="Gold")]
    locations = [LocationObject(name="Main Hall")]
    sections = [
        SectionObject(
            name="A",
            location=locations[0],
            tier=tiers[0],
            count=2,
        )
    ]
    assignment_options = AssignmentOptionObject(
        max_assignments_per_vendor=4,
        max_half_table_proportion_per_section=100,
        email_col_name_idx=0,
        table_choice_col_name_idx=2,
        table_share_email_col_name_idx=3,
        max_days_col_name_idx=4,
    )
    setup = SetupObject(
        col_names=col_names,
        col_values=[[] for _ in col_names],
        col_include=[True] * len(col_names),
        enum_priority_order=[[] for _ in col_names],
        priority=[],
        market_dates=market_dates,
        tiers=tiers,
        locations=locations,
        sections=sections,
        assignment_options=assignment_options,
    )
    headers = list(col_names)
    data_rows = [
        headers,
        ["a@example.com", "A", "Full table", "", "4", "Gold"],
        ["b@example.com", "B", "Full table", "", "4", "Gold"],
    ]
    source_data = {"headers": headers, "data": data_rows}
    return setup, source_data


def test_vendor_attributes_follow_mapping(mapping_setup_and_source):
    setup, source_data = mapping_setup_and_source
    ma = MarketAssignment(setup, source_data)
    assert len(ma.vendors) == 2
    v0 = ma.vendors[0]
    assert ma.vendor_email(v0) == "a@example.com"
    assert ma.vendor_table_choice(v0) == "Full table"
    assert ma._vendor_table_share_email_str(v0) == ""


def test_assign_market_with_column_mapping(mapping_setup_and_source):
    setup, source_data = mapping_setup_and_source
    market = Market(
        id="test-mid",
        name="Test",
        creation_date="2025-01-01",
        roles={"u1": MarketRole.OWNER},
        modification_list=[],
        assignment_object=AssignmentObject(),
        setup_object=setup,
    )
    result = assign_market(market, source_data)
    emails = {a.email for a in result.assignment_object.vendor_assignments}
    assert emails == {"a@example.com", "b@example.com"}


def test_missing_required_column_mapping_raises(mapping_setup_and_source):
    setup, source_data = mapping_setup_and_source
    bad = copy.deepcopy(setup)
    bad.assignment_options.email_col_name_idx = None
    with pytest.raises(ValueError, match="email_col_name_idx"):
        _validate_assignment_column_mappings(bad)
    with pytest.raises(ValueError, match="email_col_name_idx"):
        MarketAssignment(bad, source_data)


def test_market_date_without_col_name_or_idx_raises(mapping_setup_and_source):
    """CSV fields are Optional on the models, so the solver must reject unresolvable dates."""
    setup, source_data = mapping_setup_and_source
    bad = copy.deepcopy(setup)
    bad.market_dates[0].col_name = None
    bad.market_dates[0].col_name_idx = None
    with pytest.raises(ValueError, match=r"market_dates\[0\].col_name_idx"):
        _validate_assignment_column_mappings(bad)
    with pytest.raises(ValueError, match=r"market_dates\[0\].col_name_idx"):
        MarketAssignment(bad, source_data)


def test_market_date_col_name_idx_out_of_range_raises(mapping_setup_and_source):
    setup, source_data = mapping_setup_and_source
    bad = copy.deepcopy(setup)
    bad.market_dates[0].col_name = None
    bad.market_dates[0].col_name_idx = 99
    with pytest.raises(ValueError, match=r"market_dates\[0\].col_name_idx"):
        MarketAssignment(bad, source_data)


def test_priority_without_col_name_idx_raises(mapping_setup_and_source):
    setup, source_data = mapping_setup_and_source
    bad = copy.deepcopy(setup)
    bad.priority = [PriorityObject(id=1, col_name_idx=None, data_type=DataType.STRING, sorting_order="asc")]
    with pytest.raises(ValueError, match=r"priority\[0\].col_name_idx"):
        _validate_assignment_column_mappings(bad)
    with pytest.raises(ValueError, match=r"priority\[0\].col_name_idx"):
        MarketAssignment(bad, source_data)


def test_priority_without_enum_priority_order_entry_raises(mapping_setup_and_source):
    """An empty enum_priority_order must fail at the boundary, not IndexError inside the solver."""
    setup, source_data = mapping_setup_and_source
    bad = copy.deepcopy(setup)
    bad.enum_priority_order = []
    bad.priority = [PriorityObject(id=1, col_name_idx=1, data_type=DataType.STRING, sorting_order="asc")]
    with pytest.raises(ValueError, match="enum_priority_order"):
        _validate_assignment_column_mappings(bad)
    with pytest.raises(ValueError, match="enum_priority_order"):
        MarketAssignment(bad, source_data)


def test_empty_col_names_raises_a_message_about_the_missing_columns(mapping_setup_and_source):
    """col_names defaults to [] for application-based markets; the solver must say so plainly."""
    setup, source_data = mapping_setup_and_source
    bad = copy.deepcopy(setup)
    bad.col_names = []
    with pytest.raises(ValueError, match="col_names is empty"):
        _validate_assignment_column_mappings(bad)
    with pytest.raises(ValueError, match="col_names is empty"):
        MarketAssignment(bad, source_data)


def test_valid_priority_mapping_passes(mapping_setup_and_source):
    setup, source_data = mapping_setup_and_source
    setup.priority = [PriorityObject(id=1, col_name_idx=1, data_type=DataType.STRING, sorting_order="asc")]
    _validate_assignment_column_mappings(setup)
    assert len(MarketAssignment(setup, source_data).vendors) == 2


def test_max_days_unmapped_skips_per_vendor_cap(mapping_setup_and_source):
    """max_days_col_name_idx None => no per-vendor max from CSV (only global MAX_VENDING_DAYS)."""
    setup, source_data = mapping_setup_and_source
    setup.assignment_options.max_days_col_name_idx = None
    ma = MarketAssignment(setup, source_data)
    v = ma.vendors[0]
    v.num_assignments = 1
    assert not ma.is_vendor_max_assigned(v)
    v.num_assignments = 4
    assert ma.is_vendor_max_assigned(v)


def test_assignments_per_date_keyed_by_market_date_iso():
    """Per-date stat keys must match MarketTableRow.date (ISO) so clickable Per Date
    stat cards on the Assignment Results page correctly filter TablesView. Before
    the fix the keys were market_date.col_name (the CSV column header), which never
    matches row.date = market_date.date in the downstream TablesView filter."""
    col_names = [
        "vendor_email",
        "table_choice",
        "buddy_email",
        "Saturday availability",
    ]
    market_dates = [
        MarketDateObject(date="2026-03-15", col_name_idx=3),
    ]
    tiers = [TierObject(id=1, name="Gold")]
    locations = [LocationObject(name="Main Hall")]
    sections = [
        SectionObject(name="A", location=locations[0], tier=tiers[0], count=1),
    ]
    assignment_options = AssignmentOptionObject(
        email_col_name_idx=0,
        table_choice_col_name_idx=1,
        table_share_email_col_name_idx=2,
        max_days_col_name_idx=None,
        max_assignments_per_vendor=None,
        max_half_table_proportion_per_section=None,
    )
    setup = SetupObject(
        col_names=col_names,
        col_values=[[] for _ in col_names],
        col_include=[True] * len(col_names),
        enum_priority_order=[[] for _ in col_names],
        priority=[],
        market_dates=market_dates,
        tiers=tiers,
        locations=locations,
        sections=sections,
        assignment_options=assignment_options,
    )
    source_data = {
        "headers": list(col_names),
        "data": [
            list(col_names),
            ["a@example.com", "Full table", "", "Gold"],
        ],
    }

    ma = MarketAssignment(setup, source_data)
    ma.assign()
    stats = ma.get_assignment_statistics()

    assert "2026-03-15" in stats.assignments_per_date
    assert "Saturday availability" not in stats.assignments_per_date
