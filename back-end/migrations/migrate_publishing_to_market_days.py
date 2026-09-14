#!/usr/bin/env python3
"""Move already-published markets from `archived` to `market_days`, so they keep their check-in URL.

Why (E03/F03, wayfinder ticket 06): publishing used to be `draft -> archived`, so `archived` meant
two opposite things - this market has just gone live, and this market is over. `CONTEXT.md` names
phase as the single source of truth for a market's lifecycle, and a value meaning both is not one.

Publishing now lands in `market_days`, and `archived` means finished. Check-in serves `market_days`
only, so a market published by the old build would drop off the air without this.

**Published and abandoned are told apart by the assignment**, which is the only evidence in the
document. A market published by the old build has a computed assignment - it was published from the
results screen - while one archived from `draft` never ran and has none. That is exactly the
distinction `AssignmentComputedGuard` makes for new transitions, applied backwards.

A legacy market carrying no phase at all is `migrate_phase.py`'s to backfill first; run that, then
this.

**No boot marker, deliberately.** The marker pattern (`migrate_market_keys.py`) exists for a hazard
that is *invisible* - an unmigrated market simply does not appear anywhere, with nothing logged. This
one is loud: the check-in URL 404s and a vendor says so. Making the app refuse to boot over a loud
failure teaches operators that the refusal is noise.

Safe to run repeatedly: a market already in `market_days` is left alone.

Usage:
    docker compose run --rm backend python migrations/migrate_publishing_to_market_days.py [--dry-run]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db_config import get_database  # noqa: E402


def migrate(dry_run: bool = False) -> int:
    db = get_database()
    markets = db["markets"]

    published = abandoned = 0
    for doc in markets.find({"phase": "archived"}):
        assignment = doc.get("assignmentObject") or {}
        placements = assignment.get("vendorAssignments") or []
        name = doc.get("name", doc.get("id"))

        if not placements:
            # Never ran, so there is nothing to check in to. `archived` is already correct for it.
            abandoned += 1
            print(f"  . {name}: no assignment, left archived (abandoned)")
            continue

        published += 1
        print(f"  - {name}: {len(placements)} placement(s) -> market_days")
        if not dry_run:
            markets.update_one(
                {"_id": doc["_id"]},
                {"$set": {"phase": "market_days", "isDraft": False}},
            )

    verb = "would move" if dry_run else "moved"
    print(f"\n{verb} {published} published market(s) to market_days.")
    if abandoned:
        print(f"{abandoned} left archived because they carry no assignment.")
    return published


if __name__ == "__main__":
    raise SystemExit(0 if migrate(dry_run="--dry-run" in sys.argv) >= 0 else 1)
