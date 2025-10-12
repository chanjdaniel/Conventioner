from flask import request, jsonify, send_file
from pymongo import MongoClient
from pymongo.results import InsertOneResult, DeleteResult
from bson import ObjectId
import csv
import io
import os
from datetime import datetime
from typing import Optional, Dict, Any, List

client = MongoClient("mongodb://admin:secret@localhost:27017/admin")

db = client["market_maker"]
source_data_collection = db["source_data"]

def upload_source_data(market_name: str, csv_file) -> Dict[str, Any]:
    """Upload CSV source data for a market."""
    try:
        # Read CSV content
        csv_content = csv_file.read().decode('utf-8')
        csv_file.seek(0)  # Reset file pointer
        
        # Parse CSV to validate format
        csv_reader = csv.reader(io.StringIO(csv_content))
        rows = list(csv_reader)
        
        if not rows:
            return {"error": "CSV file is empty"}, 400
        
        # Check if market already has source data
        existing_data = source_data_collection.find_one({"market_name": market_name})
        
        source_data_doc = {
            "market_name": market_name,
            "csv_content": csv_content,
            "headers": rows[0] if rows else [],
            "row_count": len(rows) - 1,  # Exclude header
            "upload_date": datetime.utcnow(),
            "filename": csv_file.filename
        }
        
        if existing_data:
            # Update existing data
            result = source_data_collection.update_one(
                {"market_name": market_name},
                {"$set": source_data_doc}
            )
            if result.modified_count > 0:
                return {"message": f"Source data updated for market '{market_name}'", "row_count": source_data_doc["row_count"]}, 200
            else:
                return {"error": "Failed to update source data"}, 500
        else:
            # Insert new data
            result = source_data_collection.insert_one(source_data_doc)
            if result.inserted_id:
                return {"message": f"Source data uploaded for market '{market_name}'", "row_count": source_data_doc["row_count"]}, 201
            else:
                return {"error": "Failed to upload source data"}, 500
                
    except Exception as e:
        return {"error": f"Error processing CSV file: {str(e)}"}, 400

def get_source_data(market_name: str) -> Dict[str, Any]:
    """Retrieve CSV source data for a market."""
    try:
        source_data = source_data_collection.find_one({"market_name": market_name})
        
        if not source_data:
            return {"error": f"No source data found for market '{market_name}'"}, 404
        
        # Parse CSV content
        csv_reader = csv.reader(io.StringIO(source_data["csv_content"]))
        rows = list(csv_reader)
        
        return {
            "market_name": market_name,
            "headers": source_data["headers"],
            "data": rows,
            "row_count": source_data["row_count"],
            "upload_date": source_data["upload_date"],
            "filename": source_data.get("filename", "unknown")
        }, 200
        
    except Exception as e:
        return {"error": f"Error retrieving source data: {str(e)}"}, 500

def get_source_data_csv(market_name: str) -> Dict[str, Any]:
    """Retrieve CSV source data as downloadable CSV file."""
    try:
        source_data = source_data_collection.find_one({"market_name": market_name})
        
        if not source_data:
            return {"error": f"No source data found for market '{market_name}'"}, 404
        
        # Create CSV file in memory
        csv_buffer = io.StringIO()
        csv_writer = csv.writer(csv_buffer)
        
        # Write CSV content
        csv_reader = csv.reader(io.StringIO(source_data["csv_content"]))
        for row in csv_reader:
            csv_writer.writerow(row)
        
        csv_buffer.seek(0)
        
        return {
            "csv_content": csv_buffer.getvalue(),
            "filename": source_data.get("filename", f"{market_name}_source_data.csv"),
            "market_name": market_name
        }, 200
        
    except Exception as e:
        return {"error": f"Error generating CSV file: {str(e)}"}, 500

def list_source_data() -> Dict[str, Any]:
    """List all available source data files."""
    try:
        cursor = source_data_collection.find({}, {
            "market_name": 1,
            "row_count": 1,
            "upload_date": 1,
            "filename": 1,
            "headers": 1
        })
        
        source_data_list = []
        for doc in cursor:
            source_data_list.append({
                "market_name": doc["market_name"],
                "row_count": doc["row_count"],
                "upload_date": doc["upload_date"],
                "filename": doc.get("filename", "unknown"),
                "headers": doc["headers"]
            })
        
        return {"source_data": source_data_list}, 200
        
    except Exception as e:
        return {"error": f"Error listing source data: {str(e)}"}, 500

def delete_source_data(market_name: str) -> Dict[str, Any]:
    """Delete source data for a market."""
    try:
        result = source_data_collection.delete_one({"market_name": market_name})
        
        if result.deleted_count > 0:
            return {"message": f"Source data deleted for market '{market_name}'"}, 200
        else:
            return {"error": f"No source data found for market '{market_name}'"}, 404
            
    except Exception as e:
        return {"error": f"Error deleting source data: {str(e)}"}, 500

def get_source_data_headers(market_name: str) -> Dict[str, Any]:
    """Get just the headers for a market's source data."""
    try:
        source_data = source_data_collection.find_one(
            {"market_name": market_name},
            {"headers": 1, "row_count": 1}
        )
        
        if not source_data:
            return {"error": f"No source data found for market '{market_name}'"}, 404
        
        return {
            "market_name": market_name,
            "headers": source_data["headers"],
            "row_count": source_data["row_count"]
        }, 200
        
    except Exception as e:
        return {"error": f"Error retrieving headers: {str(e)}"}, 500