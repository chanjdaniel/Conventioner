from typing import Optional, Dict, Any
from pymongo import MongoClient
from pymongo.results import InsertOneResult, UpdateResult
from bson import ObjectId
from datatypes import Market

client = MongoClient("mongodb://admin:secret@localhost:27017/admin")

db = client["market_maker"]
markets_collection = db["markets"]

def get_market(market_id: str) -> Optional[Dict[str, Any]]:
    """Get a market by its ID."""
    return markets_collection.find_one({"_id": ObjectId(market_id)})

def create_market(market: Market) -> InsertOneResult:
    """Create a new market."""
    market_dict = market.model_dump()
    return markets_collection.insert_one(market_dict)

def update_market(market_id: str, market: Market) -> UpdateResult:
    """Update an existing market."""
    market_dict = market.model_dump()
    return markets_collection.update_one({"_id": ObjectId(market_id)}, {"$set": market_dict})
    