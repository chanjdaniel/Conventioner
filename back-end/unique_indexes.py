"""Building a unique index that a guarantee rests on, and naming what stops it (T270).

A write that upserts by a key is a read-then-insert: two requests that both match nothing both
insert, and only a unique index makes the second one fail. Where the product promises one record
per key, the index is the whole of the promise, so a process that cannot build it refuses to boot
(``app.py``) rather than serve with the promise silently gone.

An index that will not build almost always means the collection already holds the duplicates it
forbids, so the refusal names them: by the fields an operator may read (a market id, a date) and
each record's ``_id``, never by an address, since it is printed to a terminal and the host's logs.
The driver's own message is never repeated, nor kept as the cause, for the same reason: a
duplicate key error quotes the key.

The unique indexes built before this module keep their own owners (``api.applications``,
``api.users``, ``api.applicant_auth``, ``market_documents``); a new guarantee builds here.
"""
from typing import Any, Dict, List, Optional, Sequence

from pymongo.errors import PyMongoError

#: One vendor's day: what an attendance record is kept by, one per market, vendor and date.
VENDOR_DAY_FIELDS = ("market_id", "vendor_email", "date")
#: What a refusal or the duplicate check may print of a vendor's day: never the address.
VENDOR_DAY_SHOWN = ("market_id", "date")
#: The collections holding one record per vendor's day, each with the name of its unique index.
#: ``migrations/check_vendor_day_duplicates.py`` reads every one before a release is promoted.
VENDOR_DAY_INDEXES: Dict[str, str] = {
    "attendance": "attendance_vendor_day_unique",
}


class UniqueIndexError(RuntimeError):
    """A unique index a guarantee rests on is not in place."""


def duplicate_groups(
    collection: Any, fields: Sequence[str], shown: Sequence[str],
) -> List[Dict[str, Any]]:
    """The records sharing one key, a group per key: the ``shown`` fields' values and the ``_id``
    of every record in it, and nothing else of the key.

    One aggregation, so the database does the grouping and only the groups come back.
    """
    hidden = [field for field in shown if field not in fields]
    if hidden:
        raise ValueError(f"A shown field must be one of the key's fields: {', '.join(hidden)}")
    return list(collection.aggregate([
        {"$group": {
            "_id": {field: f"${field}" for field in fields},
            "n": {"$sum": 1},
            "ids": {"$push": "$_id"},
        }},
        {"$match": {"n": {"$gt": 1}}},
        {"$project": {"_id": 0, "ids": 1, **{field: f"$_id.{field}" for field in shown}}},
    ]))


def describe_groups(groups: List[Dict[str, Any]], shown: Sequence[str]) -> str:
    """The groups as one line: ``market_id m1, date 2026-06-10: <id>, <id>; ...``."""
    return "; ".join(
        ", ".join(f"{field} {group.get(field)}" for field in shown)
        + ": " + ", ".join(str(record_id) for record_id in group.get("ids", []))
        for group in groups
    ) or "none found"


def ensure_unique_index(
    collection: Any, fields: Sequence[str], name: str, *, shown: Sequence[str], one: str,
    partial: Optional[Dict[str, Any]] = None,
) -> None:
    """Build the unique index ``name`` on ``fields``, or raise ``UniqueIndexError`` saying why.

    Returns at once when an index of that name already stands unique, reading nothing else: a boot
    on the serverless host is every cold start. ``one`` says what the index keeps one record per,
    in the refusal's words ("one vendor's day"); ``partial`` is its partial filter, if any.
    """
    if collection.index_information().get(name, {}).get("unique"):
        return
    options: Dict[str, Any] = {"unique": True, "name": name}
    if partial is not None:
        options["partialFilterExpression"] = partial
    try:
        collection.create_index([(field, 1) for field in fields], **options)
    except PyMongoError as exc:
        try:
            groups = describe_groups(duplicate_groups(collection, fields, shown), shown)
        except PyMongoError as read_failure:
            groups = f"not read ({type(read_failure).__name__})"
        raise UniqueIndexError(
            f"The unique index {name} on {collection.name} ({', '.join(fields)}) could not be "
            f"built ({type(exc).__name__}, code {getattr(exc, 'code', None)}), so nothing stops "
            f"two records for {one}. Records sharing {one}, by {', '.join(shown)} and record id: "
            f"{groups}. Keep one of each (docs/OPERATIONS.md, When the back end refuses to boot), "
            f"then restart."
        ) from None


def ensure_vendor_day_index(collection: Any, collection_name: str) -> None:
    """One record per vendor's day in ``collection``, named ``collection_name`` in
    ``VENDOR_DAY_INDEXES``."""
    ensure_unique_index(
        collection, VENDOR_DAY_FIELDS, VENDOR_DAY_INDEXES[collection_name],
        shown=VENDOR_DAY_SHOWN, one="one vendor's day",
    )
