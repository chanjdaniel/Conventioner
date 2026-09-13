"""The assigned-market CSV an organizer downloads.

Built from the assignment itself. It used to be built from the source spreadsheet - the
organizer's own columns, carried through verbatim, with one date column appended per market date
- which is why it needed the upload to still be on hand at download time. There is no spreadsheet
behind a market any more, so the export describes what the solver decided: who is placed, where,
on which day.
"""
from typing import Any, Dict, Iterable, List, Tuple
import csv
import io
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

EMAIL_COLUMN = "Email"


def build_market_csv_rows(market_dict: Dict[str, Any]) -> Tuple[List[str], List[Dict[str, str]]]:
    """Compose CSV header + body rows from an assigned market dict.

    Header is the vendor's address followed by one column per market date. A date cell holds
    ``"<table code> - <table choice>"`` when that vendor was placed that day, and is blank
    otherwise, which is the same cell the spreadsheet-backed export produced.

    One row per placed vendor, ordered by first appearance in the assignment, so a re-run of the
    same assignment produces the same file.
    """
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

    fieldnames = [EMAIL_COLUMN] + dates
    rows = [
        {EMAIL_COLUMN: email, **{date: by_date.get(date, "") for date in dates}}
        for email, by_date in placements.items()
    ]
    return fieldnames, rows


def write_market_csv(market_dict: Dict[str, Any], target) -> None:
    """Write the assigned-market CSV to a file-like text stream."""
    fieldnames, rows = build_market_csv_rows(market_dict)
    writer = csv.DictWriter(target, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)


def market_csv_to_string(market_dict: Dict[str, Any]) -> str:
    """Render the assigned-market CSV as a UTF-8 string (no disk I/O)."""
    buffer = io.StringIO()
    write_market_csv(market_dict, buffer)
    return buffer.getvalue()


def convert_market_data_to_csv(market_dict: Dict[str, Any], csv_filename: str) -> str:
    """Write the assigned-market CSV to disk. Returns the resolved filename."""
    with open(csv_filename, "w", newline="", encoding="utf-8") as csv_file:
        write_market_csv(market_dict, csv_file)
    return csv_filename
