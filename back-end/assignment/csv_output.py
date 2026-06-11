from typing import Dict, Any, Iterable, List, Tuple
import csv
import io
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def toAttrString(s: str) -> str:
    return s.lower().replace(" ", "_")


def build_market_csv_rows(market_dict: Dict[str, Any], source_data: Dict[str, Any]) -> Tuple[List[str], List[Dict[str, str]]]:
    """Compose CSV header + body rows from an assigned market dict.

    Header = included source columns followed by one column per market date (the
    date string itself). Each row corresponds to one source CSV row; date cells
    hold "<table_code> - <table_choice>" if the vendor was assigned that date.
    """
    vendor_data = get_vendor_data(market_dict, source_data)
    fieldnames = list(vendor_data.keys())
    num_rows = len(next(iter(vendor_data.values()))) if vendor_data else 0
    rows: List[Dict[str, str]] = []
    for i in range(num_rows):
        rows.append({col: vendor_data[col][i] for col in fieldnames})
    return fieldnames, rows


def write_market_csv(market_dict: Dict[str, Any], source_data: Dict[str, Any], target) -> None:
    """Write the assigned-market CSV to a file-like text stream."""
    fieldnames, rows = build_market_csv_rows(market_dict, source_data)
    writer = csv.DictWriter(target, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)


def market_csv_to_string(market_dict: Dict[str, Any], source_data: Dict[str, Any]) -> str:
    """Render the assigned-market CSV as a UTF-8 string (no disk I/O)."""
    buffer = io.StringIO()
    write_market_csv(market_dict, source_data, buffer)
    return buffer.getvalue()


def convert_market_data_to_csv(market_dict: Dict[str, Any], source_data: Dict[str, Any], csv_filename: str) -> str:
    """Write the assigned-market CSV to disk. Returns the resolved filename."""
    with open(csv_filename, "w", newline="", encoding="utf-8") as csv_file:
        write_market_csv(market_dict, source_data, csv_file)
    return csv_filename


# return dict where keys are column names and values are list of column values
def get_vendor_data(market_dict: Dict[str, Any], source_data: Dict[str, Any]) -> Dict[str, List[str]]:
    vendor_data: Dict[str, List[str]] = {}
    col_names = market_dict["setup_object"]["col_names"]
    col_include = market_dict["setup_object"]["col_include"]
    # source_data["data"] is a list of rows, so need to transpose so that source_data["data"][i] is the values for the ith column
    data_rows = source_data["data"][1:]
    source_data_transposed = list(zip(*data_rows))
    for i in range(len(col_names)):
        if col_include[i]:
            vendor_data[col_names[i]] = list(source_data_transposed[i])

    vendor_assignments = market_dict["assignment_object"]["vendor_assignments"]
    ao = (market_dict.get("setup_object") or {}).get("assignment_options") or {}
    idx = ao.get("email_col_name_idx")
    if idx is None or not isinstance(idx, int) or idx < 0 or idx >= len(col_names):
        raise ValueError(
            "setup_object.assignment_options.email_col_name_idx is required and must be a valid column index for CSV export"
        )
    email_col_key = col_names[idx]
    for market_date in market_dict["setup_object"]["market_dates"]:
        vendor_data[market_date["date"]] = []
        for vendor_email in vendor_data[email_col_key]:
            vendor_assignment = next(
                (
                    va for va in vendor_assignments
                    if va["date"] == market_date["col_name"] and va["email"] == vendor_email
                ),
                None,
            )
            if vendor_assignment:
                assignment_string = vendor_assignment["table_code"] + " - " + vendor_assignment["table_choice"]
                vendor_data[market_date["date"]].append(assignment_string)
            else:
                vendor_data[market_date["date"]].append("")

    return vendor_data
