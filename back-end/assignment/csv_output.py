import json
import csv
import os
import sys
from typing import Dict, List, Any

# Add parent directory to path to import datatypes
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datatypes import Market


def _process_vendor_assignments(vendor_assignments: List[Dict[str, Any]]) -> tuple[Dict[str, Dict[str, Any]], List[str]]:
    """
    Helper function to process vendor assignments and extract unique dates.
    
    Args:
        vendor_assignments: List of vendor assignment dictionaries
        
    Returns:
        Tuple of (vendor_data_dict, sorted_dates_list)
    """
    if not vendor_assignments:
        return {}, []
    
    # Get unique dates and sort them
    dates = sorted(list(set(assignment['date'] for assignment in vendor_assignments)))
    
    # Create a dictionary to aggregate assignments by email
    vendor_data = {}
    
    for assignment in vendor_assignments:
        email = assignment['email']
        date = assignment['date']
        table_code = assignment['tableCode']
        table_choice = assignment['tableChoice']
        section = assignment['section']
        tier = assignment['tier']
        location = assignment['location']
        
        if email not in vendor_data:
            vendor_data[email] = {
                'email': email,
                'section': section,
                'tier': tier,
                'location': location,
                'table_choice': table_choice,
                'dates': {}
            }
        
        # Handle multiple assignments per date (store as comma-separated)
        if date in vendor_data[email]['dates']:
            vendor_data[email]['dates'][date] += f", {table_code}"
        else:
            vendor_data[email]['dates'][date] = table_code
    
    return vendor_data, dates


def _process_market_vendor_assignments(vendor_assignments: List[Any]) -> tuple[Dict[str, Dict[str, Any]], List[str]]:
    """
    Helper function to process vendor assignments from Market objects (Pydantic objects).
    
    Args:
        vendor_assignments: List of VendorAssignmentResult objects
        
    Returns:
        Tuple of (vendor_data_dict, sorted_dates_list)
    """
    if not vendor_assignments:
        return {}, []
    
    # Get unique dates and sort them
    dates = sorted(list(set(assignment.date for assignment in vendor_assignments)))
    
    # Create a dictionary to aggregate assignments by email
    vendor_data = {}
    
    for assignment in vendor_assignments:
        email = assignment.email
        date = assignment.date
        table_code = assignment.table_code
        table_choice = assignment.table_choice
        section = assignment.section
        tier = assignment.tier
        location = assignment.location
        
        if email not in vendor_data:
            vendor_data[email] = {
                'email': email,
                'section': section,
                'tier': tier,
                'location': location,
                'table_choice': table_choice,
                'dates': {}
            }
        
        # Handle multiple assignments per date (store as comma-separated)
        if date in vendor_data[email]['dates']:
            vendor_data[email]['dates'][date] += f", {table_code}"
        else:
            vendor_data[email]['dates'][date] = table_code
    
    return vendor_data, dates


def _write_csv_file(vendor_data: Dict[str, Dict[str, Any]], dates: List[str], 
                   output_filename: str, include_stats: bool = False, 
                   assignment_object: Dict[str, Any] = None) -> None:
    """
    Helper function to write vendor data to CSV file.
    
    Args:
        vendor_data: Dictionary containing processed vendor data
        dates: List of sorted market dates
        output_filename: Path to output CSV file
        include_stats: Whether to include assignment statistics columns
        assignment_object: Assignment object for statistics (if include_stats is True)
    """
    # Define CSV headers
    headers = ['email', 'section', 'tier', 'location', 'table_choice'] + dates
    
    if include_stats and assignment_object:
        headers.extend(['assignmentDate', 'totalVendorsAssigned', 'totalTablesAssigned'])
    
    # Write to CSV file
    with open(output_filename, 'w', newline='', encoding='utf-8') as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=headers)
        
        # Write header row
        writer.writeheader()
        
        # Write data rows
        for email, data in vendor_data.items():
            row = {
                'email': email,
                'section': data['section'],
                'tier': data['tier'],
                'location': data['location'],
                'table_choice': data['table_choice']
            }
            
            # Add date columns
            for date in dates:
                row[date] = data['dates'].get(date, '')
            
            # Add statistics columns if requested
            if include_stats and assignment_object:
                row['assignmentDate'] = assignment_object.get('assignmentDate', '')
                row['totalVendorsAssigned'] = assignment_object.get('totalVendorsAssigned', 0)
                row['totalTablesAssigned'] = assignment_object.get('totalTablesAssigned', 0)
            
            writer.writerow(row)


def convert_assignment_to_csv(json_file_path: str, output_filename: str = None) -> str:
    """
    Convert assignmentObject from assignedMarkets.json to CSV format with pivot structure.
    Each vendor (email) is a row, and each market date is a column with table codes as values.
    
    Args:
        json_file_path: Path to the assignedMarkets.json file
        output_filename: Optional custom filename for the CSV output. 
                        If None, uses the same name as JSON file with .csv extension
    
    Returns:
        Path to the created CSV file
    """
    # Get the directory of the JSON file
    json_dir = os.path.dirname(json_file_path)
    json_basename = os.path.basename(json_file_path)
    
    # Generate output filename if not provided
    if output_filename is None:
        output_filename = os.path.splitext(json_basename)[0] + '.csv'
    
    # Ensure output filename has .csv extension
    if not output_filename.endswith('.csv'):
        output_filename += '.csv'
    
    # Full path for the output CSV file
    csv_file_path = os.path.join(json_dir, output_filename)
    
    # Read the JSON file
    with open(json_file_path, 'r', encoding='utf-8') as json_file:
        data = json.load(json_file)
    
    # Extract assignmentObject from the data
    # The JSON structure appears to be a list with market objects
    if isinstance(data, list) and len(data) > 0:
        market_data = data[0]  # Assuming first market in the list
        assignment_object = market_data.get('assignmentObject', {})
    else:
        assignment_object = data.get('assignmentObject', {})
    
    # Extract vendor assignments
    vendor_assignments = assignment_object.get('vendorAssignments', [])
    
    if not vendor_assignments:
        print("No vendor assignments found in the assignment object.")
        return csv_file_path
    
    # Process vendor assignments using helper function
    vendor_data, dates = _process_vendor_assignments(vendor_assignments)
    
    # Write CSV file using helper function
    _write_csv_file(vendor_data, dates, csv_file_path)
    
    print(f"Successfully converted assignment data to pivot CSV: {csv_file_path}")
    print(f"Total vendors exported: {len(vendor_data)}")
    print(f"Market dates: {', '.join(dates)}")
    
    return csv_file_path


def convert_assignment_to_csv_with_stats(json_file_path: str, output_filename: str = None) -> str:
    """
    Convert assignmentObject from assignedMarkets.json to CSV format with pivot structure and statistics.
    Each vendor (email) is a row, and each market date is a column with table codes as values.
    Includes assignment metadata as additional columns.
    
    Args:
        json_file_path: Path to the assignedMarkets.json file
        output_filename: Optional custom filename for the CSV output.
                        If None, uses the same name as JSON file with '_with_stats.csv' suffix
    
    Returns:
        Path to the created CSV file
    """
    # Get the directory of the JSON file
    json_dir = os.path.dirname(json_file_path)
    json_basename = os.path.basename(json_file_path)
    
    # Generate output filename if not provided
    if output_filename is None:
        base_name = os.path.splitext(json_basename)[0]
        output_filename = f"{base_name}_with_stats.csv"
    
    # Ensure output filename has .csv extension
    if not output_filename.endswith('.csv'):
        output_filename += '.csv'
    
    # Full path for the output CSV file
    csv_file_path = os.path.join(json_dir, output_filename)
    
    # Read the JSON file
    with open(json_file_path, 'r', encoding='utf-8') as json_file:
        data = json.load(json_file)
    
    # Extract assignmentObject from the data
    if isinstance(data, list) and len(data) > 0:
        market_data = data[0]
        assignment_object = market_data.get('assignmentObject', {})
    else:
        assignment_object = data.get('assignmentObject', {})
    
    # Extract vendor assignments and statistics
    vendor_assignments = assignment_object.get('vendorAssignments', [])
    assignment_stats = assignment_object.get('assignmentStatistics', {})
    
    if not vendor_assignments:
        print("No vendor assignments found in the assignment object.")
        return csv_file_path
    
    # Process vendor assignments using helper function
    vendor_data, dates = _process_vendor_assignments(vendor_assignments)
    
    # Write CSV file with statistics using helper function
    _write_csv_file(vendor_data, dates, csv_file_path, include_stats=True, assignment_object=assignment_object)
    
    print(f"Successfully converted assignment data with stats to pivot CSV: {csv_file_path}")
    print(f"Total vendors exported: {len(vendor_data)}")
    print(f"Market dates: {', '.join(dates)}")
    print(f"Assignment date: {assignment_object.get('assignmentDate', 'N/A')}")
    print(f"Total vendors assigned: {assignment_object.get('totalVendorsAssigned', 0)}")
    print(f"Total tables assigned: {assignment_object.get('totalTablesAssigned', 0)}")
    
    return csv_file_path


def convert_market_data_to_csv(market_data: Dict[str, Any], output_filename: str = "assignedMarkets.csv") -> str:
    """
    Convert market data (from JSON) to CSV format with pivot structure.
    Each vendor (email) is a row, and each market date is a column with table codes as values.
    
    Args:
        market_data: Dictionary containing market data from JSON
        output_filename: Optional custom filename for the CSV output. 
                        Defaults to "assignedMarkets.csv"
    
    Returns:
        Path to the created CSV file
    """
    # Get the assignment object from the market data
    assignment_object = market_data.get('assignmentObject', {})
    
    # Extract vendor assignments
    vendor_assignments = assignment_object.get('vendorAssignments', [])
    
    if not vendor_assignments:
        print("No vendor assignments found in the market data.")
        return output_filename
    
    # Process vendor assignments using helper function
    vendor_data, dates = _process_vendor_assignments(vendor_assignments)
    
    # Write CSV file using helper function
    _write_csv_file(vendor_data, dates, output_filename)
    
    print(f"Successfully converted market data to pivot CSV: {output_filename}")
    print(f"Total vendors exported: {len(vendor_data)}")
    print(f"Market dates: {', '.join(dates)}")
    
    return output_filename


def convert_market_to_csv(market: Market, output_filename: str = "assignedMarkets.csv") -> str:
    """
    Convert a Market object to CSV format with pivot structure.
    Each vendor (email) is a row, and each market date is a column with table codes as values.
    
    Args:
        market: Market object containing assignment data
        output_filename: Optional custom filename for the CSV output. 
                        Defaults to "assignedMarkets.csv"
    
    Returns:
        Path to the created CSV file
    """
    # Get the assignment object from the market
    assignment_object = market.assignment_object
    
    # Extract vendor assignments
    vendor_assignments = assignment_object.vendor_assignments
    
    if not vendor_assignments:
        print("No vendor assignments found in the market object.")
        return output_filename
    
    # Process vendor assignments using helper function for Market objects
    vendor_data, dates = _process_market_vendor_assignments(vendor_assignments)
    
    # Write CSV file using helper function
    _write_csv_file(vendor_data, dates, output_filename)
    
    print(f"Successfully converted market assignment data to pivot CSV: {output_filename}")
    print(f"Total vendors exported: {len(vendor_data)}")
    print(f"Market dates: {', '.join(dates)}")
    
    return output_filename


def convert_market_to_csv_with_stats(market: Market, output_filename: str = "assignedMarkets_with_stats.csv") -> str:
    """
    Convert a Market object to CSV format with pivot structure and statistics.
    Each vendor (email) is a row, and each market date is a column with table codes as values.
    Includes assignment metadata as additional columns.
    
    Args:
        market: Market object containing assignment data
        output_filename: Optional custom filename for the CSV output.
                        Defaults to "assignedMarkets_with_stats.csv"
    
    Returns:
        Path to the created CSV file
    """
    # Get the assignment object from the market
    assignment_object = market.assignment_object
    
    # Extract vendor assignments and statistics
    vendor_assignments = assignment_object.vendor_assignments
    assignment_stats = assignment_object.assignment_statistics
    
    if not vendor_assignments:
        print("No vendor assignments found in the market object.")
        return output_filename
    
    # Process vendor assignments using helper function for Market objects
    vendor_data, dates = _process_market_vendor_assignments(vendor_assignments)
    
    # Convert assignment object to dictionary for stats
    assignment_dict = {
        'assignmentDate': assignment_object.assignment_date,
        'totalVendorsAssigned': assignment_object.total_vendors_assigned,
        'totalTablesAssigned': assignment_object.total_tables_assigned
    }
    
    # Write CSV file with statistics using helper function
    _write_csv_file(vendor_data, dates, output_filename, include_stats=True, assignment_object=assignment_dict)
    
    print(f"Successfully converted market assignment data with stats to pivot CSV: {output_filename}")
    print(f"Total vendors exported: {len(vendor_data)}")
    print(f"Market dates: {', '.join(dates)}")
    print(f"Assignment date: {assignment_object.assignment_date}")
    print(f"Total vendors assigned: {assignment_object.total_vendors_assigned}")
    print(f"Total tables assigned: {assignment_object.total_tables_assigned}")
    
    return output_filename


if __name__ == "__main__":
    # Example usage
    json_file = "/home/danielc/Documents/projects/MakersMarketManagement/back-end/tests/test_data/assignedMarkets.json"
    
    if os.path.exists(json_file):
        # Convert to basic CSV from JSON file
        csv_path = convert_assignment_to_csv(json_file)
        print(f"Basic CSV created at: {csv_path}")
        
        # Convert to CSV with statistics from JSON file
        csv_with_stats_path = convert_assignment_to_csv_with_stats(json_file)
        print(f"CSV with stats created at: {csv_with_stats_path}")
        
        # Example of converting Market data to CSV
        try:
            # Load the JSON data
            with open(json_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # Assuming the JSON contains a list with Market objects
            if isinstance(data, list) and len(data) > 0:
                market_data = data[0]  # Get first market
                
                # Convert Market data to CSV (works with raw JSON data)
                market_csv_path = convert_market_data_to_csv(market_data, "assignedMarkets.csv")
                print(f"Market data CSV created at: {market_csv_path}")
                
            else:
                print("No market data found in JSON file")
                
        except Exception as e:
            print(f"Error processing Market data: {e}")
    else:
        print(f"JSON file not found: {json_file}")
