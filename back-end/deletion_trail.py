"""What was deleted, by whom, and when (E20/F04/S01).

Nothing recorded this. ``placement_history`` covers placements only, and it is deleted WITH its
market - which is right for a trail describing something that still exists, and useless for one
describing something that does not.

Deleting an organization destroys markets, and an archived market holds the placement record of a
market that actually ran plus a check-in URL the public could still reach. That is a decision the
product allows deliberately; a decision that leaves no evidence is a different thing.

This module owns the ``deletion_trail`` collection and is its only writer. Entries outlive
everything they describe, by construction: there is nothing left to delete them with.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from db_config import get_database

logger = logging.getLogger(__name__)

DELETION_TRAIL_COLLECTION = "deletion_trail"

db = get_database()
deletion_trail_collection = db[DELETION_TRAIL_COLLECTION]

ORGANIZATION_DELETED = "organization_deleted"


def record_organization_deletion(
    organization: Dict[str, Any], markets: List[Dict[str, Any]], actor_email: str
) -> str:
    """Record an organization's deletion and everything it took with it.

    The markets are recorded as they were DESCRIBED at the moment of deletion, not as ids: an id
    that points at nothing is not a record of what was destroyed, and the whole point of this entry
    is that the thing it names is gone.

    A failure here must not leave an organization half-deleted, so the caller writes the trail
    BEFORE it deletes anything and this raises rather than swallowing.
    """
    entry = {
        "id": str(uuid.uuid4()),
        "kind": ORGANIZATION_DELETED,
        "at": datetime.now(timezone.utc).isoformat(),
        "actor_email": actor_email,
        "organization_id": organization.get("id"),
        "organization_name": organization.get("name"),
        "markets": markets,
    }
    deletion_trail_collection.insert_one(dict(entry))
    logger.info(
        "Organization %s (%s) deleted by %s, taking %d market(s)",
        organization.get("name"),
        organization.get("id"),
        actor_email,
        len(markets),
    )
    return entry["id"]


def entries_for_organization(org_id: str) -> List[Dict[str, Any]]:
    """Every recorded deletion naming this organization. Read-only; nothing here is removable."""
    found = deletion_trail_collection.find({"organization_id": org_id})
    return [{key: value for key, value in doc.items() if key != "_id"} for doc in found]
