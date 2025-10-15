#!/usr/bin/env python3

import json
import sys
import os

# Add current directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from assignment.csv_output import convert_market_data_to_csv

def test_csv_generation():
    """Test CSV generation with sample data structure"""
    
    # Create a sample market data structure that matches what the API returns
    sample_market_data = {
        "name": "Fall 2025",
        "owner": "test@example.com",
        "assignmentObject": {
            "vendorAssignments": [
                {
                    "email": "test1@example.com",
                    "date": "2025-11-17",
                    "tableCode": "A01",
                    "tableChoice": "Full table",
                    "section": "A",
                    "tier": "Gold",
                    "location": "Lower Atrium"
                },
                {
                    "email": "test2@example.com", 
                    "date": "2025-11-17",
                    "tableCode": "A02",
                    "tableChoice": "Half table - Left",
                    "section": "A",
                    "tier": "Gold",
                    "location": "Lower Atrium"
                },
                {
                    "email": "test1@example.com",
                    "date": "2025-11-18",
                    "tableCode": "A03",
                    "tableChoice": "Full table",
                    "section": "A",
                    "tier": "Gold",
                    "location": "Lower Atrium"
                }
            ],
            "assignmentDate": "2025-10-15T00:55:37.580183",
            "totalVendorsAssigned": 2,
            "totalTablesAssigned": 3
        }
    }
    
    print("Testing CSV generation with sample data...")
    print(f"Sample data keys: {list(sample_market_data.keys())}")
    print(f"Assignment object keys: {list(sample_market_data['assignmentObject'].keys())}")
    print(f"Number of vendor assignments: {len(sample_market_data['assignmentObject']['vendorAssignments'])}")
    
    try:
        csv_path = convert_market_data_to_csv(sample_market_data, "test_debug.csv")
        print(f"✅ CSV generation successful: {csv_path}")
        
        # Check if file was created
        if os.path.exists(csv_path):
            print(f"✅ File exists: {csv_path}")
            with open(csv_path, 'r') as f:
                lines = f.readlines()
                print(f"✅ File has {len(lines)} lines")
                print("First few lines:")
                for i, line in enumerate(lines[:3]):
                    print(f"  {i+1}: {line.strip()}")
        else:
            print(f"❌ File was not created: {csv_path}")
            
    except Exception as e:
        print(f"❌ CSV generation failed: {str(e)}")
        import traceback
        print(f"Traceback: {traceback.format_exc()}")

if __name__ == "__main__":
    test_csv_generation()
