#!/usr/bin/env python3
"""Bring every market's plan to the layout's shape (T257).

Why: a location's layout names its location, and each of its tables its section, by id, so every
section and location now carries a stable ``id``; and the floorplan beta's saves, which named
neither and were never read again, are not kept (Daniel: none is kept).

What it writes:

- every location and section without an id given one, and each section's copy of its location
  given that location's id: the ids ``datatypes.fill_plan_ids`` derives, the same ones every read
  of an unmigrated market already serves, so a Market Setup tab open across the run keeps writing
  the ids it read;
- every floorplan with no ``locationId`` (every one the beta saved) removed from its market;
- every file in the ``floorplan_images`` GridFS bucket that no remaining floorplan names deleted,
  but one uploaded after the run began, which a layout being started may be about to name;
- ``layouts_v1`` recorded in ``schema_migrations``.

Each market is written in one update conditional on the plan it read, so a market written while
this runs is left for the next run. Safe to run repeatedly: a second run finds nothing to change.
``--dry-run`` prints what it would change and the counts, and writes and deletes nothing.

The build that ships layouts reads an unmigrated market without failing (its ids derived as it is
read, a beta floorplan ignored), so there is no boot refusal: run this after the deploy.

Usage, from ``back-end/`` (the production database address passed inline, never from ``.env``):
    MONGODB_URI='<production URI>' python migrations/migrate_layouts.py --dry-run
    MONGODB_URI='<production URI>' python migrations/migrate_layouts.py
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Set

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datatypes import fill_plan_ids  # noqa: E402

MIGRATION_ID = "layouts_v1"
SCHEMA_COLLECTION = "schema_migrations"
IMAGE_BUCKET = "floorplan_images"


def _has_location(floorplan: Any) -> bool:
    location = floorplan.get("locationId") if isinstance(floorplan, dict) else None
    return isinstance(location, str) and bool(location.strip())


def plan_change(setup: Any) -> Dict[str, Any]:
    """The ``$set`` that brings one stored plan to the layout's shape; empty when it is there."""
    if not isinstance(setup, dict):
        return {}
    change: Dict[str, Any] = {}
    filled = fill_plan_ids(setup)
    for key in ("locations", "sections"):
        if filled.get(key) != setup.get(key):
            change[f"setupObject.{key}"] = filled[key]
    floorplans = setup.get("floorplans")
    if isinstance(floorplans, list):
        kept = [floorplan for floorplan in floorplans if _has_location(floorplan)]
        if len(kept) != len(floorplans):
            change["setupObject.floorplans"] = kept
    return change


def _images_named(floorplans: Iterable[Any]) -> Set[str]:
    return {
        str(floorplan["imageGridfsId"]) for floorplan in floorplans
        if isinstance(floorplan, dict) and floorplan.get("imageGridfsId")
    }


def _floorplans_after(setup: Any, change: Dict[str, Any]) -> List[Any]:
    if "setupObject.floorplans" in change:
        return change["setupObject.floorplans"]
    floorplans = setup.get("floorplans") if isinstance(setup, dict) else None
    return floorplans if isinstance(floorplans, list) else []


def _uploaded_before(grid_out: Any, started: datetime) -> bool:
    uploaded: Optional[datetime] = getattr(grid_out, "upload_date", None)
    if uploaded is None:
        return True
    if uploaded.tzinfo is None:
        uploaded = uploaded.replace(tzinfo=timezone.utc)
    return uploaded < started


def migrate(db, images, dry_run: bool = False, started: Optional[datetime] = None) -> Dict[str, int]:
    """Migrate every market and the image bucket, or say what would change.

    ``images`` is the ``floorplan_images`` GridFS bucket. Returns the counts it printed.
    """
    started = started or datetime.now(timezone.utc)
    verb = "Would" if dry_run else "Did"
    counts = {"markets": 0, "floorplans_removed": 0, "images_deleted": 0, "raced": 0}
    named: Set[str] = set()

    for doc in db.markets.find({}):
        setup = doc.get("setupObject")
        change = plan_change(setup)
        named |= _images_named(_floorplans_after(setup, change))
        if not change:
            continue
        name = doc.get("name") or doc.get("id")
        removed = len(setup.get("floorplans") or []) - len(_floorplans_after(setup, change))
        given = [key.split(".")[1] for key in change if key != "setupObject.floorplans"]
        print(f"  - {name}: "
              + (f"ids given to its {' and '.join(given)}" if given else "")
              + ("; " if given and removed else "")
              + (f"{removed} beta floorplan(s) removed" if removed else ""))
        if not dry_run:
            result = db.markets.update_one({"_id": doc["_id"], "setupObject": setup},
                                           {"$set": change})
            if not result.matched_count:
                counts["raced"] += 1
                # Its images stay: what it holds now is unknown until the next run reads it.
                named |= _images_named(setup.get("floorplans") or [])
                print(f"  ! {name}: changed while this ran; run it again")
                continue
        counts["markets"] += 1
        counts["floorplans_removed"] += removed

    for grid_out in list(images.find({})):
        if str(grid_out._id) in named or not _uploaded_before(grid_out, started):
            continue
        counts["images_deleted"] += 1
        if not dry_run:
            images.delete(grid_out._id)

    print(f"\n{verb} bring {counts['markets']} market(s) to the layout's shape, removing "
          f"{counts['floorplans_removed']} beta floorplan(s).")
    print(f"{verb} delete {counts['images_deleted']} floorplan image(s) no floorplan names.")
    if dry_run:
        print(f"Would record '{MIGRATION_ID}' in '{SCHEMA_COLLECTION}'.")
    elif counts["raced"]:
        print(f"{counts['raced']} market(s) changed while this ran: run it again; "
              f"'{MIGRATION_ID}' is not recorded.")
    else:
        db[SCHEMA_COLLECTION].update_one(
            {"_id": MIGRATION_ID},
            {"$set": {"appliedAt": started.isoformat()}},
            upsert=True,
        )
        print(f"Recorded '{MIGRATION_ID}' in '{SCHEMA_COLLECTION}'.")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true",
                        help="Say what would change; write and delete nothing")
    args = parser.parse_args()

    from gridfs import GridFS

    from db_config import get_database

    db = get_database()
    migrate(db, GridFS(db, collection=IMAGE_BUCKET), dry_run=args.dry_run)


if __name__ == "__main__":
    main()
