from flask import request, jsonify, send_file
from pymongo.results import InsertOneResult, DeleteResult
from bson import ObjectId
import csv
import io
import os
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from db_config import get_database

db = get_database()
source_data_collection = db["source_data"]

def upload_source_data(market_id: str, csv_file) -> Dict[str, Any]:
    """Upload CSV source data for a market."""
    try:
        csv_content = csv_file.read().decode('utf-8')
        csv_file.seek(0)
        csv_reader = csv.reader(io.StringIO(csv_content))
        rows = list(csv_reader)
        
        if not rows:
            return {"error": "CSV file is empty"}, 400
        
        existing_data = source_data_collection.find_one({"market_id": market_id})
        
        source_data_doc = {
            "market_id": market_id,
            "csv_content": csv_content,
            "headers": rows[0] if rows else [],
            "row_count": len(rows) - 1,
            "upload_date": datetime.now(timezone.utc),
            "filename": csv_file.filename
        }
        
        if existing_data:
            result = source_data_collection.update_one(
                {"market_id": market_id},
                {"$set": source_data_doc}
            )
            if result.modified_count > 0:
                return {"message": f"Source data updated for market", "row_count": source_data_doc["row_count"]}, 200
            else:
                return {"error": "Failed to update source data"}, 500
        else:
            result = source_data_collection.insert_one(source_data_doc)
            if result.inserted_id:
                return {"message": f"Source data uploaded for market", "row_count": source_data_doc["row_count"]}, 201
            else:
                return {"error": "Failed to upload source data"}, 500
                
    except Exception as e:
        return {"error": f"Error processing CSV file: {str(e)}"}, 400

def get_source_data(market_id: str) -> Dict[str, Any]:
    """Retrieve CSV source data for a market."""
    try:
        source_data = source_data_collection.find_one({"market_id": market_id})
        
        if not source_data:
            return {"error": f"No source data found for market"}, 404
        
        csv_reader = csv.reader(io.StringIO(source_data["csv_content"]))
        rows = list(csv_reader)
        
        return {
            "market_id": market_id,
            "headers": source_data["headers"],
            "data": rows,
            "row_count": source_data["row_count"],
            "upload_date": source_data["upload_date"],
            "filename": source_data.get("filename", "unknown")
        }, 200
        
    except Exception as e:
        return {"error": f"Error retrieving source data: {str(e)}"}, 500

def get_source_data_csv(market_id: str) -> Dict[str, Any]:
    """Retrieve CSV source data as downloadable CSV file."""
    try:
        source_data = source_data_collection.find_one({"market_id": market_id})
        
        if not source_data:
            return {"error": f"No source data found for market"}, 404
        
        csv_buffer = io.StringIO()
        csv_writer = csv.writer(csv_buffer)
        csv_reader = csv.reader(io.StringIO(source_data["csv_content"]))
        for row in csv_reader:
            csv_writer.writerow(row)
        csv_buffer.seek(0)
        
        return {
            "csv_content": csv_buffer.getvalue(),
            "filename": source_data.get("filename", f"{market_id}_source_data.csv"),
            "market_id": market_id
        }, 200
        
    except Exception as e:
        return {"error": f"Error generating CSV file: {str(e)}"}, 500

def list_source_data() -> Dict[str, Any]:
    """List all available source data files."""
    try:
        cursor = source_data_collection.find({}, {
            "market_id": 1,
            "row_count": 1,
            "upload_date": 1,
            "filename": 1,
            "headers": 1
        })
        
        source_data_list = []
        for doc in cursor:
            source_data_list.append({
                "market_id": doc.get("market_id"),
                "row_count": doc["row_count"],
                "upload_date": doc["upload_date"],
                "filename": doc.get("filename", "unknown"),
                "headers": doc["headers"]
            })
        
        return {"source_data": source_data_list}, 200
        
    except Exception as e:
        return {"error": f"Error listing source data: {str(e)}"}, 500

def delete_source_data(market_id: str) -> Dict[str, Any]:
    """Delete source data for a market."""
    try:
        result = source_data_collection.delete_one({"market_id": market_id})
        
        if result.deleted_count > 0:
            return {"message": f"Source data deleted for market"}, 200
        else:
            return {"error": f"No source data found for market"}, 404
            
    except Exception as e:
        return {"error": f"Error deleting source data: {str(e)}"}, 500

def get_source_data_headers(market_id: str) -> Dict[str, Any]:
    """Get just the headers for a market's source data."""
    try:
        source_data = source_data_collection.find_one(
            {"market_id": market_id},
            {"headers": 1, "row_count": 1}
        )
        
        if not source_data:
            return {"error": f"No source data found for market"}, 404
        
        return {
            "market_id": market_id,
            "headers": source_data["headers"],
            "row_count": source_data["row_count"]
        }, 200
        
    except Exception as e:
        return {"error": f"Error retrieving headers: {str(e)}"}, 500