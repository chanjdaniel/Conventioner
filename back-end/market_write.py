"""The one place a judged write to a market is made: it lands only on the market as it was read.

A request reads a market, judges a rule on it (the phase allows this, the review is open, the
person's role is what it was), and then writes. A write by id alone stores whatever it carries over
whatever changed in between, so a rule judged on a draft could land on a market that had opened
applications a moment before. ``write_market`` holds the facts the judgment read, in the same
update that writes: always the market's ``id``, its stored ``phase`` and that it is not being
deleted, and the keys the caller names. When any of them moved, the write stores nothing and raises ``MarketChanged``, one 409 every
screen reads in the same words.

What a write holds, the writes that may not come through here, and the test that finds every write
to the markets collection: docs/implementation/modules/market-write.md, and ADR 0024.
"""
from typing import Any, Dict, Mapping, NamedTuple, Optional, Sequence

from pymongo import ReturnDocument

from client_errors import ConflictError, NotFoundError
from datatypes import Market
from db_config import get_database
from market_documents import MARKETS_COLLECTION, market_doc_key
from tombstone import live, tombstone_of

markets_collection = get_database()[MARKETS_COLLECTION]

#: The one sentence an organizer reads when a write met a market that changed under it.
MARKET_CHANGED = (
    "This market changed while you were working on it, so your change was not saved. "
    "Reload to see the latest, then make your change again."
)


class MarketNotFoundError(NotFoundError):
    """No market exists with the requested id: a 404."""


class MarketChanged(ConflictError):
    """A write met a market that changed since the request read it, and stored nothing: a 409.

    ``latest`` is the market as it stands now, for a caller that answers in its own terms (the phase
    move's blockers); the client reads the sentence and ``code``, which the front end tells this
    refusal apart by, and re-reads the market.
    """

    def __init__(self, latest: Dict[str, Any]):
        super().__init__(MARKET_CHANGED)
        self.latest = latest

    def body(self) -> Dict[str, Any]:
        return {"error": MARKET_CHANGED, "code": "market_changed"}


class Written(NamedTuple):
    """What a write that landed stored: every revision and count key it counted, as now stored."""
    revisions: Dict[str, int]


#: A path that reaches no value in the document as read, as distinct from a value that is null.
_MISSING = object()


def write_market(
    as_read: Market | Mapping[str, Any],
    update: Mapping[str, Any],
    *,
    holds: Sequence[str] = (),
    revisions: Optional[Mapping[str, Optional[int]]] = None,
    counts: Sequence[str] = (),
) -> Written:
    """Write ``update`` to the market ``as_read`` was read from, only while it still is that market.

    ``as_read`` is a ``Market`` a loader parsed (its stored document is what is held) or a raw
    document a caller read itself. The write holds:

    - the market's ``id`` and its stored ``phase`` as read, absent when the read had none, so a
      write a phase rule judged never lands after a move, an archive or a return to draft;
    - the market live (``tombstone.live``), so no write lands on a market being deleted;
    - each key in ``holds``, a stored key in its canonical spelling (``market_doc_key``), dotted for
      a nested one, at its value as read: equal to it, absent when the read had no such key, and a
      null matching null or missing. A sub-document is held by equality, which the server reads in
      field order; the value is the server's own, read back in the order it is stored;
    - each key in ``revisions`` at the revision the writer stood on (0 or None also matching a
      market that never stored one), and counts it up by one.

    Each key in ``counts`` is counted up by one and not held. One ``find_one_and_update``: no read
    and write that another request can land between.

    Answers ``Written`` with every revision and count key as the server stored it.

    Raises:
        MarketChanged: the market changed since it was read; nothing was stored.
        MarketNotFoundError: the market is gone, or being deleted.
        RuntimeError: ``as_read`` is a ``Market`` built in code, with no stored document to hold.
    """
    document = document_as_read(as_read)
    revisions = dict(revisions or {})
    market_id = document["id"]

    condition: Dict[str, Any] = live({"id": market_id})
    for key in (market_doc_key("phase"), *holds):
        condition[key] = _held_at(document, key)
    for key, revision in revisions.items():
        condition[key] = {"$in": [None, 0]} if not revision else revision

    counted = [*revisions, *counts]
    written = dict(update)
    if counted:
        increments = dict(written.get("$inc", {}))
        for key in counted:
            if key in increments:
                raise RuntimeError(f"write_market counts {key} itself; the update must not")
            increments[key] = 1
        written["$inc"] = increments

    after = markets_collection.find_one_and_update(
        condition, written, projection={"_id": 1, **{key: 1 for key in counted}},
        return_document=ReturnDocument.AFTER,
    )
    if after is None:
        latest = markets_collection.find_one({"id": market_id})
        if latest is None or tombstone_of(latest) is not None:
            raise MarketNotFoundError("Market not found")
        raise MarketChanged(latest)
    return Written({key: _value_at(after, key) for key in counted})


def document_as_read(as_read: Market | Mapping[str, Any]) -> Mapping[str, Any]:
    """The stored document a write holds: a raw document as given, or the one a loader parsed a
    ``Market`` from, for a caller that judges what the write holds by what was stored (whether the
    stored rows are a map Mongo can set a key in). Never mutate it."""
    if not isinstance(as_read, Market):
        return as_read
    stored = as_read._stored_document
    if stored is None:
        raise RuntimeError(
            "write_market was given a Market with no stored document: hand it the market a loader "
            "read (market_from_document), not one built in code")
    return stored


def _held_at(document: Mapping[str, Any], key: str) -> Any:
    """The condition holding ``key`` at its value in ``document``: equal to it (a null matching
    null or missing, as the server reads an equality), or absent when the read had none.

    Plain equality, since a stored key never starts with ``$``; a value that would read as
    operators (a sub-document whose first key does) is held by ``$eq`` instead."""
    value = _value_at(document, key)
    if value is _MISSING:
        return {"$exists": False}
    if isinstance(value, Mapping) and value and next(iter(value)).startswith("$"):
        return {"$eq": value}
    return value


def _value_at(document: Mapping[str, Any], key: str) -> Any:
    """The value ``key`` reaches by name through sub-documents, or ``_MISSING``. A path through a
    list is refused: a dotted filter matches any element there, so equality would not hold it."""
    value: Any = document
    for part in key.split("."):
        if isinstance(value, list):
            raise RuntimeError(f"write_market cannot hold {key}: it runs through a list")
        if not isinstance(value, Mapping) or part not in value:
            return _MISSING
        value = value[part]
    return value
