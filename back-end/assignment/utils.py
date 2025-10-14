import json
import csv
import os
from typing import Dict, List, Any


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
    
    # Define CSV headers
    headers = ['email', 'section', 'tier', 'location', 'table_choice'] + dates
    
    # Write to CSV file
    with open(csv_file_path, 'w', newline='', encoding='utf-8') as csv_file:
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
            
            writer.writerow(row)
    
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
    
    # Define CSV headers including assignment metadata
    headers = ['email', 'section', 'tier', 'location', 'table_choice'] + dates + [
        'assignmentDate', 'totalVendorsAssigned', 'totalTablesAssigned'
    ]
    
    # Write to CSV file
    with open(csv_file_path, 'w', newline='', encoding='utf-8') as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=headers)
        
        # Write header row
        writer.writeheader()
        
        # Write data rows with additional metadata
        for email, data in vendor_data.items():
            row = {
                'email': email,
                'section': data['section'],
                'tier': data['tier'],
                'location': data['location'],
                'table_choice': data['table_choice'],
                'assignmentDate': assignment_object.get('assignmentDate', ''),
                'totalVendorsAssigned': assignment_object.get('totalVendorsAssigned', 0),
                'totalTablesAssigned': assignment_object.get('totalTablesAssigned', 0)
            }
            
            # Add date columns
            for date in dates:
                row[date] = data['dates'].get(date, '')
            
            writer.writerow(row)
    
    print(f"Successfully converted assignment data with stats to pivot CSV: {csv_file_path}")
    print(f"Total vendors exported: {len(vendor_data)}")
    print(f"Market dates: {', '.join(dates)}")
    print(f"Assignment date: {assignment_object.get('assignmentDate', 'N/A')}")
    print(f"Total vendors assigned: {assignment_object.get('totalVendorsAssigned', 0)}")
    print(f"Total tables assigned: {assignment_object.get('totalTablesAssigned', 0)}")
    
    return csv_file_path


if __name__ == "__main__":
    # Example usage
    json_file = "/home/danielc/Documents/projects/MakersMarketManagement/back-end/tests/test_data/assignedMarkets.json"
    
    if os.path.exists(json_file):
        # Convert to basic CSV
        csv_path = convert_assignment_to_csv(json_file)
        print(f"Basic CSV created at: {csv_path}")
        
        # Convert to CSV with statistics
        csv_with_stats_path = convert_assignment_to_csv_with_stats(json_file)
        print(f"CSV with stats created at: {csv_with_stats_path}")
    else:
        print(f"JSON file not found: {json_file}")
