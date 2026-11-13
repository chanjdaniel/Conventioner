#!/usr/bin/env python3
"""Give every stored market its assignment state (T316).

The assignment now stores where it stands, ``assignmentObject.state`` (``none``, ``pinned`` or
``run``), and a run always records what it was made from, ``madeFrom``. Publish results stores the
assignment revision it stood on, ``assignmentObject.publishedRevision``. A market stored before
that has none of them, and one a rolled-back release wrote may store a state its rows contradict.

For each live market (``tombstone.live``), this sets:

- ``state``, where it is absent or disagrees with the stored rows and ``madeFrom``, to the state
  the lifecycle's derivation rule reads off them (``assignment.lifecycle.derived_state``);
- ``madeFrom`` to the legacy marker (``assignment.lifecycle.LEGACY_MADE_FROM``) where the rule
  reads an allocation stored before runs recorded one, so it reads as current, as it does now;
- ``publishedRevision``, on a market with results published and none recorded, to the stored
  ``revision`` (0 when there is none), so its results read as published, as they do now.

Each write goes through ``write_market``, holding what the judgment read: the phase, the revision
(held, not counted, since the rows are unchanged and a published market's revision is the one its
results stood on), the state, ``madeFrom``, ``resultsPublished`` and ``publishedRevision``. A market
that changed meanwhile is read and judged again, up to three tries, then listed as skipped.

**No boot marker**: an unmigrated market reads correctly through ``lifecycle.state_of``, which
derives the state by the same rule, so the migration only makes the stored state the owner's.

Run it once the release is deployed, ``--dry-run`` first, and again after any roll-forward past a
rollback: safe to run repeatedly, since a market whose state agrees and whose published revision
is recorded is left alone. It prints market ids, never a name or an address.

Usage (the production database address passed inline, never from back-end/.env):
    MONGODB_URI='<URI>' python migrations/migrate_assignment_state.py [--dry-run]
"""
import os
import sys
from typing import Any, Dict, List, Mapping, Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pydantic import ValidationError  # noqa: E402

import market_write as MarketWrite  # noqa: E402
from assignment.lifecycle import derived_state, stored_state_agrees  # noqa: E402
from assignment.utils import convert_keys_to_snake_case  # noqa: E402
from datatypes import AssignmentObject  # noqa: E402
from market_documents import MARKETS_COLLECTION, market_doc_key  # noqa: E402
from market_write import MarketChanged, MarketNotFoundError, write_market  # noqa: E402
from tombstone import live  # noqa: E402

#: How many times a market that changed between its read and its write is read and judged again.
TRIES = 3

ASSIGNMENT = market_doc_key("assignment_object")
RESULTS_PUBLISHED = market_doc_key("results_published")
STATE = f"{ASSIGNMENT}.state"
MADE_FROM = f"{ASSIGNMENT}.madeFrom"
REVISION = f"{ASSIGNMENT}.revision"
PUBLISHED_REVISION = f"{ASSIGNMENT}.publishedRevision"

#: What the judgment reads, and so what the read fetches: ``write_market`` holds the id and phase.
PROJECTION = {"_id": 0, "id": 1, market_doc_key("phase"): 1, ASSIGNMENT: 1, RESULTS_PUBLISHED: 1}


class Unreadable(Exception):
    """A market whose stored assignment does not parse; the app cannot read it either."""


def assignment_of(document: Mapping[str, Any]) -> AssignmentObject:
    """The stored assignment as the app reads it, its ``madeFrom`` kept as spelled, since its keys
    are a run's groups, not field names."""
    stored = dict(document.get(ASSIGNMENT) or {})
    made_from = stored.pop("madeFrom", None)
    try:
        model = AssignmentObject(**convert_keys_to_snake_case(stored))
    except ValidationError as error:
        raise Unreadable(f"{error.error_count()} field(s) do not parse") from error
    return model.model_copy(update={"made_from": made_from})


def what_to_set(document: Mapping[str, Any]) -> Dict[str, Any]:
    """The keys this market needs set, by their stored path, and their values: none when its
    state agrees with its rows and a published market records its revision."""
    assignment = assignment_of(document)
    setting: Dict[str, Any] = {}
    if not stored_state_agrees(assignment):
        derived = derived_state(assignment)
        setting[STATE] = derived.state.value
        if not assignment.made_from and derived.made_from:
            setting[MADE_FROM] = derived.made_from
    if document.get(RESULTS_PUBLISHED) and assignment.published_revision is None:
        setting[PUBLISHED_REVISION] = assignment.revision
    return setting


def described(setting: Mapping[str, Any]) -> str:
    """What is set, as the operator reads it: the values, never a name or an address."""
    words = []
    if STATE in setting:
        words.append(f"state {setting[STATE]}")
    if MADE_FROM in setting:
        words.append("madeFrom legacy")
    if PUBLISHED_REVISION in setting:
        words.append(f"publishedRevision {setting[PUBLISHED_REVISION]}")
    return ", ".join(words)


def migrate(db=None, dry_run: bool = False) -> int:
    """Returns the number of markets set, or that would be set on a dry run."""
    if db is None:
        from db_config import get_database
        db = get_database()
    markets = db[MARKETS_COLLECTION]
    if markets != MarketWrite.markets_collection:
        raise RuntimeError(
            "migrate_assignment_state reads the markets write_market writes: pass the configured "
            "database, or none")

    changed = 0
    skipped: List[str] = []
    unreadable: List[str] = []
    for document in markets.find(live({}), PROJECTION):
        market_id = document["id"]
        try:
            setting = set_one(markets, document, dry_run)
        except Unreadable as error:
            unreadable.append(market_id)
            print(f"  - market {market_id}: left, its assignment is unreadable ({error})")
            continue
        if setting is None:
            skipped.append(market_id)
        elif setting:
            changed += 1
            print(f"  - market {market_id}: {described(setting)}")

    verb = "would set" if dry_run else "set"
    print(f"\n{verb} {changed} market(s).")
    if skipped:
        print(f"skipped {len(skipped)} market(s) that changed on every try: {', '.join(skipped)}."
              " Run it again.")
    if unreadable:
        print(f"left {len(unreadable)} market(s) whose assignment is unreadable: "
              f"{', '.join(unreadable)}.")
    return changed


def set_one(markets, document: Mapping[str, Any], dry_run: bool) -> Optional[Dict[str, Any]]:
    """Judge one market and write what it needs: what was set, empty when it needs nothing (or is
    gone), or None when it changed between the read and the write on every try."""
    for _ in range(TRIES):
        setting = what_to_set(document)
        if not setting or dry_run:
            return setting
        try:
            write_market(document, {"$set": setting},
                         holds=(STATE, MADE_FROM, REVISION, PUBLISHED_REVISION, RESULTS_PUBLISHED))
            return setting
        except MarketNotFoundError:
            return {}
        except MarketChanged:
            document = markets.find_one(live({"id": document["id"]}), PROJECTION)
            if document is None:
                return {}
    return None


if __name__ == "__main__":
    migrate(dry_run="--dry-run" in sys.argv)
