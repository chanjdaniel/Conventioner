"""Regression tests for unassigned half-table side labels."""
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from assignment.assignment import Table, HALF_TABLE_LEFT_LABEL, HALF_TABLE_RIGHT_LABEL
from datatypes import MarketDateObject, TierObject, LocationObject, SectionObject


def _build_table(table_code: str = "meh18", date: str = "2026-03-17") -> Table:
    market_date = MarketDateObject(date=date, col_name_idx=0, col_name=date)
    tier = TierObject(id=1, name="Gold")
    location = LocationObject(name="Main Hall")
    section = SectionObject(name="A", location=location, tier=tier, count=1)
    return Table(market_date, table_code, section, tier, location)


def _build_vendor_with_assignment(date: str, table_code: str, table_choice, *, as_dict: bool = False):
    row = {
        "table_code": table_code,
        "table_choice": table_choice,
    }
    stored_row = row if as_dict else SimpleNamespace(**row)
    return SimpleNamespace(assignment={date: stored_row})


def test_available_table_choice_returns_opposite_side_when_left_assigned():
    table = _build_table()
    vendor = _build_vendor_with_assignment(table.date.date, table.table_code, HALF_TABLE_LEFT_LABEL)
    table.assign([vendor])
    assert table.available_table_choice() == HALF_TABLE_RIGHT_LABEL


def test_available_table_choice_returns_opposite_side_when_right_assigned():
    table = _build_table()
    vendor = _build_vendor_with_assignment(table.date.date, table.table_code, HALF_TABLE_RIGHT_LABEL)
    table.assign([vendor])
    assert table.available_table_choice() == HALF_TABLE_LEFT_LABEL


def test_available_table_choice_supports_dict_assignment_rows():
    table = _build_table()
    vendor = _build_vendor_with_assignment(
        table.date.date,
        table.table_code,
        "Half Table - Left",
        as_dict=True,
    )
    table.assign([vendor])
    assert table.available_table_choice() == HALF_TABLE_RIGHT_LABEL


def test_available_table_choice_falls_back_when_side_unknown():
    table = _build_table()
    vendor = _build_vendor_with_assignment(table.date.date, table.table_code, "Half Table")
    table.assign([vendor])
    assert table.available_table_choice() == "Half Table"


def test_available_table_choice_supports_camel_case_dict_rows():
    table = _build_table()
    vendor = SimpleNamespace(
        assignment={
            table.date.date: {
                "tableCode": table.table_code,
                "tableChoice": "Half Table (Right)",
            }
        }
    )
    table.assign([vendor])
    assert table.available_table_choice() == HALF_TABLE_LEFT_LABEL
