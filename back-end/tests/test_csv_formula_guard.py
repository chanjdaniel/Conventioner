"""The assignment CSV never hands the organizer a live formula.

A vendor's name, full name and address are the applicant's own text, and a spreadsheet reads a
cell beginning ``=``, ``+``, ``-``, ``@``, tab, CR or LF as a formula. So the export prefixes such a
cell with a single quote, which the spreadsheet shows as text (OWASP, CSV injection), and leaves
every other cell exactly as it was.
"""
import csv
import io

import pytest

from assignment.csv_output import market_csv_to_string


def _market(*emails):
    return {
        "setup_object": {"market_dates": [{"date": "2026-08-01"}]},
        "assignment_object": {
            "vendor_assignments": [
                {
                    "email": email, "date": "2026-08-01",
                    "table_code": f"Front Row {index}", "table_choice": "Full Table",
                }
                for index, email in enumerate(emails, start=1)
            ],
        },
    }


def _rows(market, names=None, full_names=None):
    """The file as the organizer's spreadsheet reads it."""
    return list(csv.DictReader(io.StringIO(market_csv_to_string(market, names, full_names))))


def test_a_formula_leading_name_arrives_as_text():
    formula = "=1+1"

    [row] = _rows(
        _market("nadia@ember.test"),
        {"nadia@ember.test": formula}, {"nadia@ember.test": formula},
    )

    assert row["Name"] == "'" + formula
    assert row["Full name"] == "'" + formula


def test_an_at_leading_value_arrives_as_text():
    [row] = _rows(_market("@sum@ember.test"), {"@sum@ember.test": "@SUM(1+1)"})

    assert row["Name"] == "'@SUM(1+1)"
    assert row["Email"] == "'@sum@ember.test"


@pytest.mark.parametrize("lead", ["=", "+", "-", "@", "\t", "\r", "\n"])
def test_every_character_a_spreadsheet_reads_as_a_formula_is_guarded(lead):
    [row] = _rows(
        _market("nadia@ember.test"),
        {"nadia@ember.test": f"{lead}1+1"}, {"nadia@ember.test": f"{lead}cmd"},
    )

    assert row["Name"] == f"'{lead}1+1"
    assert row["Full name"] == f"'{lead}cmd"


def test_ordinary_values_export_exactly_as_before():
    """A dash, an at sign or a quote inside a value is not at its start, so nothing changes."""
    rows = _rows(
        _market("nadia@ember.test", "theo@thistle.test", "blank@ember.test"),
        {"nadia@ember.test": "Nadia Okonkwo-Reyes", "theo@thistle.test": "Theo's Thistles @ Home"},
        {"nadia@ember.test": "Nadia Okonkwo", "theo@thistle.test": "Theo M. = Maker"},
    )

    assert [(row["Name"], row["Full name"], row["Email"]) for row in rows] == [
        ("Nadia Okonkwo-Reyes", "Nadia Okonkwo", "nadia@ember.test"),
        ("Theo's Thistles @ Home", "Theo M. = Maker", "theo@thistle.test"),
        ("", "", "blank@ember.test"),
    ]


def test_the_table_cells_are_not_touched():
    """Only the applicant's own text is guarded; the date cells are the organizer's plan."""
    [row] = _rows(_market("nadia@ember.test"), {"nadia@ember.test": "=1+1"})

    assert row["2026-08-01"] == "Front Row 1 - Full Table"
