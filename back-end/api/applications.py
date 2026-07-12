"""Single owner of the ``applications`` collection.

Every reader and writer of an application document goes through this module so the
storage contract lives in exactly one place.

Storage contract: application documents are persisted **snake_case**, matching the
``Application`` model in ``datatypes.py``. In particular the market foreign key is
``market_id``, not ``marketId`` - markets are camelCased on write, applications are not.
The D9 form lock counts applications by that key, so a writer that stored the market
reference under any other name would silently disable the lock.
"""
from typing import Any, Dict

from db_config import get_database

APPLICATIONS_COLLECTION = "applications"
MARKET_ID_FIELD = "market_id"

db = get_database()
applications_collection = db[APPLICATIONS_COLLECTION]


def market_filter(market_id: str) -> Dict[str, Any]:
    """The canonical query for every application belonging to one market."""
    return {MARKET_ID_FIELD: market_id}


def count_applications_for_market(market_id: str) -> int:
    """How many applications exist for a market. Drives the D9 application-form lock."""
    return applications_collection.count_documents(market_filter(market_id))
