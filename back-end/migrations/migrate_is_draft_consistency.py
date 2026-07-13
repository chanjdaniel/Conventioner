#!/usr/bin/env python3
"""One-time migration: bring ``isDraft`` and ``phase`` into agreement on every stored market.

Idempotent -- running it twice is harmless.

After PR 4 (publish-advance-phase), ``isDraft`` is derived strictly from ``phase``:
   phase == "draft"  ->  isDraft: true
   phase != "draft"  ->  isDraft: false

Two document shapes disagree, and they are repaired in *opposite* directions, because which
field carried the truth depends on which build wrote it:

``phase: "draft"`` + ``isDraft: false`` -- a market PUBLISHED BY THE OLD BUILD. Publishing was
a ``PUT`` of ``isDraft: false``; ``create_market`` had already stamped ``phase: "draft"`` and
``update_market`` re-applied the stored phase, so the phase never moved. ``isDraft`` was the
only publish signal that existed, which makes it the authoritative one here: the phase is
advanced to ``archived`` (where the new publish path lands) and ``isDraft`` stays false.
Confirming these as drafts instead would take a live market's public check-in URL off the air,
because the slug lookup now decides on phase.

``phase != "draft"`` + ``isDraft: true`` -- a market the transition endpoint advanced before
``isDraft`` joined the atomic update. Here the phase is the field that moved, so ``isDraft`` is
the stale one and is recomputed from it.

Only documents that actually store a ``phase`` are touched. A document without one has no
lifecycle state to disagree with: ``phase_from_market_document`` derives its phase *from*
``isDraft``, so it is already consistent, and rewriting either field would be inventing a
lifecycle. ``migrations/migrate_phase.py`` is what backfills those, with the same mapping.

Server-side update operators only (no scan-then-replace). The old app keeps serving writes
while this runs; a whole-document replace would silently revert concurrent edits, so every fix
is a targeted ``$set`` whose filter still names the disagreement it repairs. Matching on
``_id`` alone would not: a market the app transitions between the survey read and the write
would have the value computed for its *old* phase written back onto its new one, recreating the
very disagreement this exists to remove. Each ``update_many`` is handed the same predicate that
selected the group, so Mongo re-checks it per document as it writes.

Usage:
    python migrations/migrate_is_draft_consistency.py
    python migrations/migrate_is_draft_consistency.py --dry-run
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datatypes import MarketPhase
from db_config import get_database


DRAFT = MarketPhase.DRAFT.value
# The phase the new publish path lands on, and so the phase a market the old build published
# should end up in.
PUBLISHED = MarketPhase.ARCHIVED.value

# Every query below is scoped to documents that carry a `phase`. `$ne` alone would also match a
# document with no `phase` field -- a market written before the field existed -- and flipping its
# `isDraft` would rewrite the only lifecycle state it has: `phase_from_market_document` reads a
# phase-less document as draft when isDraft is true and archived when it is false, so setting
# isDraft=false here would silently archive every legacy draft, with no transition out of
# `archived` to undo it. Those documents are already self-consistent under that mapping and are
# backfilled by `migrations/migrate_phase.py`.
NON_DRAFT_PHASE = {"$exists": True, "$ne": DRAFT}

# (filter, $set, label). The filter is both what selects a group and what Mongo re-checks per
# document as it writes, so a concurrent transition drops the document out of the repair
# instead of having a stale value written over it.
REPAIRS = [
    (
        {"phase": DRAFT, "isDraft": False},
        {"phase": PUBLISHED},
        f"phase == draft, isDraft=false (published by the old build) -> phase {PUBLISHED}",
    ),
    (
        {"phase": NON_DRAFT_PHASE, "isDraft": True},
        {"isDraft": False},
        "phase != draft, isDraft=true -> isDraft false",
    ),
    (
        {"phase": DRAFT, "isDraft": {"$exists": False}},
        {"isDraft": True},
        "isDraft missing, phase=draft -> isDraft true",
    ),
    (
        {"phase": NON_DRAFT_PHASE, "isDraft": {"$exists": False}},
        {"isDraft": False},
        "isDraft missing, phase!=draft -> isDraft false",
    ),
]


def migrate(db, dry_run=False):
    collection = db.markets

    if dry_run:
        total = 0
        for query, changes, label in REPAIRS:
            for doc in collection.find(query):
                total += 1
                print(
                    f"[DRY RUN] market {doc.get('id')}: "
                    f"phase={doc.get('phase')} isDraft={doc.get('isDraft')} "
                    f"-> would set {changes} ({label})"
                )
        print(f"\nDRY RUN: would update {total} market(s)")
        return

    updated = 0
    for query, changes, label in REPAIRS:
        result = collection.update_many(query, {"$set": changes})
        if result.modified_count:
            print(f"  {label}: {result.modified_count}")
        updated += result.modified_count

    print(f"Updated {updated} market(s) total")
    if updated == 0:
        print("All markets already consistent -- migration was already applied.")


def main():
    parser = argparse.ArgumentParser(
        description="Bring isDraft and phase into agreement on every stored market"
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without applying")
    args = parser.parse_args()

    db = get_database()
    migrate(db, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
