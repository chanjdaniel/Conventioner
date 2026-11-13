"""What was deleted, by whom, and when (E20/F04/S01).

Nothing recorded this. The market's ``history`` is deleted WITH its market - which is right for a
record describing something that still exists, and useless for one describing something that does
not - so this trail stays apart from it (ADR 0017).

Deleting an organization destroys markets, and an archived market holds the placement record of a
market that actually ran plus a check-in URL the public could still reach. That is a decision the
product allows deliberately; a decision that leaves no evidence is a different thing.

This module owns the ``deletion_trail`` collection and is its only writer. Entries outlive
everything they describe, by construction: there is nothing left to delete them with.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from pymongo.errors import DuplicateKeyError

from db_config import get_database

logger = logging.getLogger(__name__)

DELETION_TRAIL_COLLECTION = "deletion_trail"

db = get_database()
deletion_trail_collection = db[DELETION_TRAIL_COLLECTION]

ORGANIZATION_DELETED = "organization_deleted"


def record_organization_deletion(
    organization: Dict[str, Any], markets: List[Dict[str, Any]], actor_email: str, trail_id: str,
) -> str:
    """Record an organization's deletion and everything it took with it, once.

    The markets are recorded as they were DESCRIBED at the moment of deletion, not as ids: an id
    that points at nothing is not a record of what was destroyed, and the whole point of this entry
    is that the thing it names is gone.

    A failure here must not leave an organization half-deleted, so the caller writes the trail
    BEFORE it deletes anything and this raises rather than swallowing. The entry's id is the
    deletion's trail id (its ``_id`` too, so the server refuses a second), and a retry of a
    deletion cut after this keeps the entry written first, describing the markets as they stood
    before any went.
    """
    entry = {
        "id": trail_id,
        "kind": ORGANIZATION_DELETED,
        "at": datetime.now(timezone.utc).isoformat(),
        "actor_email": actor_email,
        "organization_id": organization.get("id"),
        "organization_name": organization.get("name"),
        "markets": markets,
    }
    try:
        deletion_trail_collection.insert_one({"_id": trail_id, **entry})
    except DuplicateKeyError:
        return trail_id
    logger.info(
        "Organization %s (%s) deleted by %s, taking %d market(s)",
        organization.get("name"),
        organization.get("id"),
        actor_email,
        len(markets),
    )
    return trail_id


def is_recorded(trail_id: str) -> bool:
    """Whether a deletion's entry is written: once it is, the deletion has decided what it takes."""
    return deletion_trail_collection.find_one({"_id": trail_id}, {"_id": 1}) is not None


def entries_for_organization(org_id: str) -> List[Dict[str, Any]]:
    """Every recorded deletion naming this organization. Read-only; nothing here is removable."""
    found = deletion_trail_collection.find({"organization_id": org_id})
    return [{key: value for key, value in doc.items() if key != "_id"} for doc in found]
