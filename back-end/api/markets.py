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
            assigned_market_dict = convert_keys_to_camel_case(assigned_market_dict)
            return assigned_market_dict, 200
        except Exception as validation_error:
            logger.error(f"Market validation error: {validation_error}")
            logger.error(f"Validation error type: {type(validation_error)}")
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
