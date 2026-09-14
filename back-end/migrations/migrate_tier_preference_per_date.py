#!/usr/bin/env python3
"""Convert stored flat tier answers to the per-date shape.

Why (E01/F05, wayfinder ticket 02): `essential_tier_preference` used to be one set of tiers for the
whole application. Tier is a hard filter AND it sets the price, so a single set lets the solver
place a vendor at a tier they offered on one day - and charge them for it - on another. A real form
asks the question per day and promises "the highest tier available among the selections made" for
that day, in writing, to the applicant.

The conversion is the only honest one available: a flat answer meant "these tiers, on every date I
am available", so it becomes exactly that. No information is invented and none is lost.

**No boot marker, deliberately.** The marker pattern (`migrate_market_keys.py`) exists for a hazard
that is *invisible* - an unmigrated market simply does not appear anywhere. A flat tier answer is
loud: the solver reports the application as incomplete and names the applicant, so the run refuses
rather than misplacing anyone. Making the app refuse to boot over a loud failure teaches operators
that the refusal is noise, which is the one thing the market-keys check must not become.

Safe to run repeatedly: an answer already keyed by date is left untouched.

Usage:
    docker compose run --rm backend python migrations/migrate_tier_preference_per_date.py [--dry-run]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db_config import get_database  # noqa: E402
from essential_fields import AVAILABLE_DATES_KEY, TIER_PREFERENCE_KEY  # noqa: E402


def migrate(dry_run: bool = False) -> int:
    db = get_database()
    applications = db["applications"]

    changed = stranded = 0
    for doc in applications.find({f"form_data.{TIER_PREFERENCE_KEY}": {"$exists": True}}):
        form_data = doc.get("form_data") or {}
        tiers = form_data.get(TIER_PREFERENCE_KEY)

        if isinstance(tiers, dict):
            continue  # already per-date
        if not isinstance(tiers, list):
            continue

        who = doc.get("applicant_email", doc.get("id"))
        dates = form_data.get(AVAILABLE_DATES_KEY) or []
        if tiers and not dates:
            # Nothing to key the answer by. Left alone rather than guessed at: the solver will
            # name this applicant as incomplete, which is the right outcome for an answer nobody
            # can place in time.
            stranded += 1
            print(f"  ? {who}: {tiers} but no available dates, left alone")
            continue

        per_date = {date: list(tiers) for date in dates}
        changed += 1
        print(f"  - {who}: {tiers} -> {len(per_date)} date(s)")
        if not dry_run:
            applications.update_one(
                {"_id": doc["_id"]},
                {"$set": {f"form_data.{TIER_PREFERENCE_KEY}": per_date}},
            )

    verb = "would convert" if dry_run else "converted"
    print(f"\n{verb} {changed} application(s).")
    if stranded:
        print(f"{stranded} left alone because they name no available dates.")
    return changed


if __name__ == "__main__":
    raise SystemExit(0 if migrate(dry_run="--dry-run" in sys.argv) >= 0 else 1)
