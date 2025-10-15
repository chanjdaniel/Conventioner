from typing import Optional, Dict, Any, List
from pymongo import MongoClient
from pymongo.results import InsertOneResult, UpdateResult
from bson import ObjectId
from datatypes import Market
from assignment.assignment import assign_market
from assignment.utils import convert_keys_to_snake_case, convert_keys_to_camel_case
import api.source_data as SourceDataApi
import traceback
import logging
import os
from assignment.csv_output import convert_market_data_to_csv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

client = MongoClient("mongodb://admin:secret@localhost:27017/admin")

db = client["market_maker"]
markets_collection = db["markets"]

def get_market(owner_email: str, market_name: str) -> Optional[Dict[str, Any]]:
    """Get a market by its ID."""
    return markets_collection.find_one({"name": market_name, "owner": owner_email})

def get_markets_by_owner_email(owner_email: str) -> List[Dict[str, Any]]:
    """Get all markets by owner."""
    return list(markets_collection.find({"owner": owner_email}))

def create_market(owner_email: str, market: Market) -> InsertOneResult:
    """Create a new market."""
    market_dict = market.model_dump()
    market_dict = convert_keys_to_camel_case(market_dict)
    existing_market = markets_collection.find_one({"name": market.name, "owner": owner_email})
    if existing_market:
        raise ValueError("Market already exists")
    return markets_collection.insert_one(market_dict)

def update_market(owner_email: str, market_name: str, market: Market) -> UpdateResult:
    """Update an existing market."""
    market_dict = market.model_dump()
    market_dict = convert_keys_to_camel_case(market_dict)
    existing_market = markets_collection.find_one({"name": market_name, "owner": owner_email})
    if not existing_market:
        raise ValueError("Market not found")
    return markets_collection.update_one({"name": market_name, "owner": owner_email}, {"$set": market_dict})

def get_assigned_market(owner_email: str, market_name: str) -> tuple[Dict[str, Any], int]:
    """Get an assigned market."""
    try:
        market_dict = markets_collection.find_one({"name": market_name, "owner": owner_email})
        if not market_dict:
            return {"error": "Market not found"}, 404
        
        market_dict = convert_keys_to_snake_case(market_dict)
        print("market_dict keys:", market_dict.keys())
        
        # Fix missing assignment_options in setup_object
        if "setup_object" in market_dict and market_dict["setup_object"]:
            if "assignment_options" not in market_dict["setup_object"]:
                market_dict["setup_object"]["assignment_options"] = {
                    "max_assignments_per_vendor": None,
                    "max_half_table_proportion_per_section": None
                }
        
        # Fix None assignment_object
        if "assignment_object" not in market_dict or market_dict["assignment_object"] is None:
            market_dict["assignment_object"] = {
                "vendor_assignments": [],
                "assignment_date": "",
                "total_vendors_assigned": 0,
                "total_tables_assigned": 0,
                "assignment_statistics": None
            }

        # get market source data
        source_data = None
        try:
            # Get source data and extract the dictionary
            source_data_result = SourceDataApi.get_source_data(market_name)
            if source_data_result is None:
                raise Exception("Source data not found")
                
            source_data, _ = source_data_result  # Extract dict, ignore status code

        except Exception as e:
            logger.error(f"Error getting market source data: {str(e)}")
            logger.error(f"Error type: {type(e)}")

        # Convert dictionary to Market object
        try:
            market = Market(**market_dict)
            assigned_market = assign_market(market, source_data)
            assigned_market_dict = assigned_market.model_dump()

            # generate CSV if the request was successful
            try:
                # Create CSV file in a dedicated directory
                csv_dir = "csv_exports"
                os.makedirs(csv_dir, exist_ok=True)
                csv_filename = os.path.join(csv_dir, f"{market_name}_assigned.csv")
                
                # Use absolute path to ensure file is created in the correct location
                csv_filename = os.path.abspath(csv_filename)
                
                logger.info(f"Attempting to generate CSV: {csv_filename}")
                logger.info(f"Current working directory: {os.getcwd()}")
                logger.info(f"CSV directory exists: {os.path.exists(csv_dir)}")
                logger.info(f"CSV directory absolute path: {os.path.abspath(csv_dir)}")
                logger.info(f"Source data available: {source_data is not None}")
                logger.info(f"Market data keys: {list(assigned_market_dict.keys())}")
                
                # Convert the assigned market data to CSV
                result_filename = convert_market_data_to_csv(assigned_market_dict, source_data, csv_filename)
                logger.info(f"CSV exported successfully: {result_filename}")
                logger.info(f"CSV file exists: {os.path.exists(result_filename)}")
                logger.info(f"CSV file absolute path: {os.path.abspath(result_filename)}")
                
                # List all files in csv_exports directory
                try:
                    csv_files = os.listdir(csv_dir)
                    logger.info(f"Files in csv_exports directory: {csv_files}")
                except Exception as e:
                    logger.error(f"Error listing csv_exports directory: {e}")
                
            except Exception as csv_error:
                # Log CSV generation error but don't fail the API call
                logger.error(f"Failed to generate CSV for {market_name}: {str(csv_error)}")
                logger.error(f"CSV generation traceback: {traceback.format_exc()}")

            assigned_market_dict = convert_keys_to_camel_case(assigned_market_dict)
            return assigned_market_dict, 200

        except Exception as validation_error:
            logger.error(f"Market validation error: {validation_error}")
            logger.error(f"Validation error type: {type(validation_error)}")
            logger.error(f"Full traceback: {traceback.format_exc()}")  # Add this line
            if hasattr(validation_error, 'errors'):
                logger.error(f"Validation errors: {validation_error.errors()}")
            
            # Return more detailed validation error
            error_details = {
                "error": "Market validation failed",
                "message": str(validation_error),
                "error_type": type(validation_error).__name__,
                "market_name": market_name,
                "owner_email": owner_email
            }
            
            if hasattr(validation_error, 'errors'):
                error_details["validation_errors"] = validation_error.errors()
            
            return error_details, 400

    except Exception as e:
        logger.error(f"Unexpected error in get_assigned_market: {str(e)}")
        logger.error(f"Error type: {type(e)}")
        
        # Return detailed error information
        return {
            "error": "Internal server error",
            "message": str(e),
            "error_type": type(e).__name__,
            "market_name": market_name,
            "owner_email": owner_email,
            "function": "get_assigned_market"
        }, 500
