from typing import Optional, Dict, Any, List
from pymongo import MongoClient
from pymongo.results import InsertOneResult, UpdateResult
from bson import ObjectId
from datatypes import Market
from assignment.assignment import assign_market

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
    existing_market = markets_collection.find_one({"name": market.name, "owner": owner_email})
    if existing_market:
        raise ValueError("Market already exists")
    return markets_collection.insert_one(market_dict)

def update_market(owner_email: str, market_name: str, market: Market) -> UpdateResult:
    """Update an existing market."""
    market_dict = market.model_dump()
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

        # Fix missing required fields for Market validation
        if "creationDate" not in market_dict:
            from datetime import datetime
            market_dict["creationDate"] = datetime.now().isoformat()
        
        # Fix missing assignmentOptions in setupObject
        if "setupObject" in market_dict and market_dict["setupObject"]:
            if "assignmentOptions" not in market_dict["setupObject"]:
                market_dict["setupObject"]["assignmentOptions"] = {
                    "maxAssignmentsPerVendor": None,
                    "maxHalfTableProportionPerSection": None
                }
        
        # Fix None assignmentObject
        if "assignmentObject" not in market_dict or market_dict["assignmentObject"] is None:
            market_dict["assignmentObject"] = {
                "vendorAssignments": [],
                "assignmentDate": "",
                "totalVendorsAssigned": 0,
                "totalTablesAssigned": 0,
                "assignmentStatistics": None
            }

        # Convert dictionary to Market object
        market = Market.model_validate(market_dict)
        
        assigned_market = assign_market(market)
        return assigned_market.model_dump(), 200
    except Exception as e:
        print(str(e))
        return {"error": str(e)}, 500