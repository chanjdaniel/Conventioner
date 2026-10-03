"""Every field this product looks a document up by is indexed.

The ids of markets, organizations and users were indexed only on databases old enough to have run
``migrations/migrate_to_uuid.py``. A database created since - every dev stack, CI, and any new
deployment - had none of them, nor an index on an application's id, on a user's email, or on the
market a check-in or a placement change belongs to. Each of those reads was a scan of the whole
collection: nothing a fresh test database notices, and everything a full one does. On a stack
holding 25,000 applications, a 314-row import scanned them all twice per row and took 12 seconds.

Declared here once, and built at boot. These are lookups only. Where a collection's correctness
rests on a UNIQUE index, the module that relies on it builds that index and refuses to serve
without it (``api.applications``, ``market_documents``, ``api.applicant_auth``): a unique index
that will not build is a decision about data, and it belongs with the guarantee, not with a
speed-up.
"""
import logging
from typing import Any, Dict, List, Optional, Tuple

import db_config
from api.applications import APPLICATIONS_COLLECTION
from deletion_trail import DELETION_TRAIL_COLLECTION
from market_documents import MARKETS_COLLECTION, market_doc_key
from placement_history import PLACEMENT_HISTORY_COLLECTION

logger = logging.getLogger(__name__)

ORGANIZATIONS_COLLECTION = "organizations"
USERS_COLLECTION = "users"
ATTENDANCE_COLLECTION = "attendance"

# Each entry is the fields one index covers, in order. A collection read by a field that is not
# here is read by scanning it, so a new lookup belongs here when it is written.
LOOKUP_INDEXES: Dict[str, List[Tuple[str, ...]]] = {
    MARKETS_COLLECTION: [
        (market_doc_key("id"),),
        # An organization's markets: the Markets list, and deleting an organization.
        (market_doc_key("organization_id"),),
        # The markets a person holds a role on: a role is a key of the roles map, named by the
        # person's id, so only a wildcard index covers it.
        (f"{market_doc_key('roles')}.$**",),
    ],
    ORGANIZATIONS_COLLECTION: [
        ("id",),
        # "The organizations this person is in" is an $or over these three; each is indexed so
        # the query can use all of them.
        ("owner",),
        ("admins",),
        ("members",),
    ],
    USERS_COLLECTION: [
        ("id",),
        ("email",),
        ("verification_token",),
        ("password_reset_token",),
    ],
    APPLICATIONS_COLLECTION: [
        ("id",),
    ],
    ATTENDANCE_COLLECTION: [
        ("market_id", "vendor_email"),
    ],
    PLACEMENT_HISTORY_COLLECTION: [
        ("market_id",),
    ],
    DELETION_TRAIL_COLLECTION: [
        ("organization_id",),
    ],
}


def _indexed_fields(collection: Any) -> set:
    """The field lists the collection's existing indexes cover, whatever their names or options."""
    return {
        tuple(field for field, _direction in info["key"])
        for info in collection.index_information().values()
    }


def _boot_database() -> Any:
    """The database boot builds into. Its own function, so the test suite - which has no database -
    can answer it in-process, as it answers the migration probe."""
    return db_config.get_database()


def ensure_lookup_indexes(db: Optional[Any] = None) -> List[str]:
    """Build every index in ``LOOKUP_INDEXES`` the database lacks, and say which were built.

    An index on the same fields already there is left alone, whatever its options: the migrated
    databases hold unique id indexes under the default names, and asking for a plain one beside
    them would be refused as a conflict.
    """
    db = _boot_database() if db is None else db
    built = []
    for collection_name, indexes in LOOKUP_INDEXES.items():
        collection = db[collection_name]
        present = _indexed_fields(collection)
        for fields in indexes:
            if fields in present:
                continue
            collection.create_index([(field, 1) for field in fields])
            built.append(f"{collection_name}({', '.join(fields)})")
    if built:
        logger.info("Built lookup indexes: %s", "; ".join(built))
    return built
