"""The assigned-market CSV an organizer downloads.

Built from the assignment itself. It used to be built from the source spreadsheet - the
organizer's own columns, carried through verbatim, with one date column appended per market date
- which is why it needed the upload to still be on hand at download time. There is no spreadsheet
behind a market any more, so the export describes what the solver decided: who is placed, where,
on which day.
"""
from typing import Any, Dict, Iterable, List, Optional, Tuple
import csv
import io
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

NAME_COLUMN = "Name"
# The name on their identification, beside the one they chose (E35/F03/S02).
FULL_NAME_COLUMN = "Full name"
EMAIL_COLUMN = "Email"
# Whether the review approved them: a seat given by hand to someone it left out is said (E36/F02/S03).
APPROVAL_COLUMN = "Approval"

# What a spreadsheet reads as the start of a formula (OWASP, CSV injection).
FORMULA_LEADS = ("=", "+", "-", "@", "\t", "\r", "\n")


def as_text_cell(value: str) -> str:
    """The applicant's own text as a cell no spreadsheet runs: a value beginning with a formula
    character gets a leading single quote, which Excel and Sheets show as text; any other value,
    a blank one included, is written exactly as it is.

    A name is the applicant's own text, so it is written as text.
    """
    return "'" + value if value.startswith(FORMULA_LEADS) else value


def build_market_csv_rows(
    market_dict: Dict[str, Any], vendor_names: Optional[Dict[str, str]] = None,
    full_names: Optional[Dict[str, str]] = None, not_approved: Iterable[str] = (),
) -> Tuple[List[str], List[Dict[str, str]]]:
    """Compose CSV header + body rows from an assigned market dict.

    Header is the name the vendor chose, their full name, and their address, followed by one column
    per market date. A date cell holds ``"<table code> - <table choice>"`` when that vendor was
    placed that day, and is blank otherwise, which is the same cell the spreadsheet-backed export
    produced.

    Name AND address, never name instead: two vendors can share a name, while the address is
    unique, is what check-in matches on, and is what ties a row back to the vendor's application.
    A vendor with no stored name gets a blank cell rather than a placeholder, which is how this
    file read before names existed.

    The name, full name and address are the applicant's own text, so each goes through
    ``as_text_cell``; the date cells are the organizer's plan and are written as they are.

    One row per placed vendor, ordered by first appearance in the assignment, so a re-run of the
    same assignment produces the same file.
    """
    names = vendor_names or {}
    full = full_names or {}
    outside = {address.strip().lower() for address in not_approved}
    setup = market_dict.get("setup_object") or {}
    assignment = market_dict.get("assignment_object") or {}
    vendor_assignments = assignment.get("vendor_assignments") or []
    dates = [market_date["date"] for market_date in (setup.get("market_dates") or [])]

    placements: Dict[str, Dict[str, str]] = {}
    for placement in vendor_assignments:
        email = placement.get("email") or ""
        if not email:
            continue
        by_date = placements.setdefault(email, {})
        by_date[placement.get("date")] = (
            f"{placement.get('table_code')} - {placement.get('table_choice')}"
        )

    fieldnames = [NAME_COLUMN, FULL_NAME_COLUMN, EMAIL_COLUMN, APPROVAL_COLUMN] + dates
    rows = [
        {
            NAME_COLUMN: as_text_cell(names.get(email.strip().lower(), "")),
            FULL_NAME_COLUMN: as_text_cell(full.get(email.strip().lower(), "")),
            EMAIL_COLUMN: as_text_cell(email),
            APPROVAL_COLUMN: "Not approved" if email.strip().lower() in outside else "Approved",
            **{date: by_date.get(date, "") for date in dates},
        }
        for email, by_date in placements.items()
    ]
    return fieldnames, rows


def write_market_csv(
    market_dict: Dict[str, Any], target, vendor_names: Optional[Dict[str, str]] = None,
    full_names: Optional[Dict[str, str]] = None, not_approved: Iterable[str] = (),
) -> None:
    """Write the assigned-market CSV to a file-like text stream."""
    fieldnames, rows = build_market_csv_rows(market_dict, vendor_names, full_names, not_approved)
    writer = csv.DictWriter(target, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)


def market_csv_to_string(
    market_dict: Dict[str, Any], vendor_names: Optional[Dict[str, str]] = None,
    full_names: Optional[Dict[str, str]] = None, not_approved: Iterable[str] = (),
) -> str:
    """Render the assigned-market CSV as a UTF-8 string (no disk I/O)."""
    buffer = io.StringIO()
    write_market_csv(market_dict, buffer, vendor_names, full_names, not_approved)
    return buffer.getvalue()


def convert_market_data_to_csv(market_dict: Dict[str, Any], csv_filename: str) -> str:
    """Write the assigned-market CSV to disk. Returns the resolved filename."""
    with open(csv_filename, "w", newline="", encoding="utf-8") as csv_file:
        write_market_csv(market_dict, csv_file)
    return csv_filename
