"""A market or an organization being deleted carries a tombstone, and reads as absent while it does.

Deleting one is many writes: its records, collection by collection, then the document itself. With
no state of its own, a target stayed live until the last of them, so a deletion cut halfway and
retried judged again what it had half destroyed, and a write landing in between went on to a
target that was going. Now a deletion first sets ``deleting: {at, by, trail_id}`` on its target,
by one conditional write, and only then destroys anything:

    live --delete--> deleting --each step--> deleting --last step--> gone
    deleting --retry--> deleting (resumed, with its trail id)

Every request's read of a market or an organization asks for a live one (``live``), so a deleting
target answers as absent, and every write to one holds it live. A retry reads the tombstone and
resumes with its trail id, so what the deletion records it records once. An absent field reads as
live: no stored document needs a migration.

The two deletions: docs/implementation/modules/market-deletion.md, and
docs/business/rules/when-an-organization-may-be-deleted.md.
"""
from datetime import datetime, timezone
import uuid
from typing import Any, Dict, Mapping, Optional

#: The stored key of a target's tombstone, the same on a market and an organization.
DELETING = "deleting"

#: The condition a live target meets: it carries no tombstone.
LIVE: Mapping[str, Any] = {DELETING: {"$exists": False}}


def live(query: Mapping[str, Any]) -> Dict[str, Any]:
    """``query``, narrowed to live targets: the filter every request's read and write of a market or
    an organization goes through, so one being deleted reads as absent and takes no write."""
    if DELETING in query:
        raise RuntimeError(f"live() was given a query that already names {DELETING}")
    return {**query, **LIVE}


def tombstone_of(document: Optional[Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
    """The tombstone a stored document carries, or None for a live one (or no document)."""
    found = (document or {}).get(DELETING)
    return dict(found) if isinstance(found, Mapping) else None


def new_tombstone(by: Optional[str]) -> Dict[str, Any]:
    """A tombstone for a deletion starting now, by ``by``, with a trail id of its own: the id the
    deletion records under, so a retry, which reuses it, records nothing twice."""
    return {"at": datetime.now(timezone.utc).isoformat(), "by": by, "trail_id": str(uuid.uuid4())}
