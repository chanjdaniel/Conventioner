from typing import Optional, Dict, Any, List
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

def get_markets_by_owner_email(owner_email: str) -> List[Dict[str, Any]]:
    """Get all markets by owner."""
    return list(markets_collection.find({"owner": owner_email}))

def create_market(market: Market) -> InsertOneResult:
    """Create a new market."""
    market_dict = market.model_dump()
    existing_market = markets_collection.find_one({"name": market.name})
    if existing_market:
        raise ValueError("Market already exists")
    return markets_collection.insert_one(market_dict)

def update_market(market_id: str, market: Market) -> UpdateResult:
    """Update an existing market."""
    market_dict = market.model_dump()
    existing_market = markets_collection.find_one({"_id": ObjectId(market_id)})
    if not existing_market:
        raise ValueError("Market not found")
    return markets_collection.update_one({"_id": ObjectId(market_id)}, {"$set": market_dict})
