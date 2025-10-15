from typing import Optional, Dict, Any, List
import csv
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def toAttrString(str):
    str = str.lower()
    str = str.replace(' ', '_')
    return str

def convert_market_data_to_csv(market_dict: Dict[str, Any], source_data: Dict[str, Any], csv_filename: str):
    vendor_data = get_vendor_data(market_dict, source_data)

    # write vendor data to csv
    with open(csv_filename, 'w', newline='', encoding='utf-8') as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=vendor_data.keys())
        writer.writeheader()
        # Convert the transposed data back to rows
        num_rows = len(next(iter(vendor_data.values()))) if vendor_data else 0
        for i in range(num_rows):
            row = {col_name: col_values[i] for col_name, col_values in vendor_data.items()}
            writer.writerow(row)

    return csv_filename

# return dict where keys are column names and values are list of column values
def get_vendor_data(market_dict: Dict[str, Any], source_data: Dict[str, Any]):
    vendor_data = {}
    col_names = market_dict["setup_object"]["col_names"]
    col_include = market_dict["setup_object"]["col_include"]
    # source_data["data"] is a list of rows, so need to transpose so that source_data["data"][i] is the values for the ith column
    data_rows = source_data["data"][1:]
    source_data_transposed = list(zip(*data_rows))
    for i in range(len(col_names)):
        if col_include[i]:
            vendor_data[col_names[i]] = source_data_transposed[i]
    
    vendor_assignments = market_dict["assignment_object"]["vendor_assignments"]
    for market_date in market_dict["setup_object"]["market_dates"]:
        vendor_data[market_date["date"]] = []
        for vendor_email in vendor_data["Email"]:
            vendor_assignment = next((va for va in vendor_assignments if (va["date"] == market_date["col_name"] and va["email"] == vendor_email)), None)
            if vendor_assignment:
                assignment_string = vendor_assignment["table_code"] + " - " + vendor_assignment["table_choice"]
                vendor_data[market_date["date"]].append(assignment_string)
            else:
                vendor_data[market_date["date"]].append("")

    return vendor_data
