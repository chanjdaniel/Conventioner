#!/usr/bin/env python3
"""Move every market into the one stage where applications arrive and are reviewed (E38/F04/S01).

Why: ``applications_open``, ``applications_closed`` and ``review`` became one phase, ``applications``
(shown "Review" on a Google Form market and "Applications" on one whose vendors apply on its page),
and this build knows no other name for it. A market left in an old phase reads as an unknown one,
which ``phase_from_market_document`` degrades to archived: read-only, its applicant form closed.

What it writes, each market in one update conditional on the phase it read:

- ``phase: "applications"`` for a market in any of the three old phases;
- ``applicationsStopped: true`` for a market whose vendors apply on its page and that stood in
  ``applications_closed`` or ``review``: such a market reached ``review`` only through
  ``applications_closed``, so its form was closed in both, and closing applications is now a fact
  about the form inside the stage (E38/F04/S02), so it keeps refusing new applications while its
  review goes on;
- ``phase: "draft"`` instead for a Google Form market that holds no application: the stage is entered
  by a first import (``ResponsesImportedGuard`` is its entry invariant), so a market that imported
  nothing waits in draft for it, its form's publication stamp cleared and a draft entry added to its
  history, as a return to draft would; the dry run names each one;
- every phase-history entry naming an old phase renamed ``applications``, on every market, so the
  rail reads how far an archived market got from names it knows.

Safe to run repeatedly: a second run finds nothing to change. ``--dry-run`` prints what it would
change, market by market, and the counts, and writes nothing.

Run it immediately before the deploy that ships the stage. The old back end reads ``applications``
as an unknown phase, so between this run and the new back end going live those markets read as
archived (read-only, nothing written); the new back end reads the old names the same way, so the
other order leaves them archived until this runs.

Usage, from ``back-end/`` (for production, put the URI on the command line, never in ``.env``):
    MONGODB_URI='mongodb+srv://...' python migrations/migrate_to_one_stage.py --dry-run
    MONGODB_URI='mongodb+srv://...' python migrations/migrate_to_one_stage.py
"""
import argparse
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

OLD_PHASES = ("applications_open", "applications_closed", "review")
STAGE = "applications"
DRAFT = "draft"
#: The old phases an own-form market's form was closed in: ``review`` was reached only through
#: ``applications_closed``.
CLOSED_PHASES = ("applications_closed", "review")


def _history(doc: Dict[str, Any]) -> List[Any]:
    history = doc.get("phaseHistory")
    return history if isinstance(history, list) else []


def _renamed(history: List[Any]) -> List[Any]:
    return [
        {**entry, "phase": STAGE}
        if isinstance(entry, dict) and entry.get("phase") in OLD_PHASES else entry
        for entry in history
    ]


def change_for(doc: Dict[str, Any], applications: int) -> Dict[str, Any]:
    """The ``$set`` that brings one stored market into the stage's vocabulary; empty when none.

    ``applications`` is how many applications the market holds."""
    change: Dict[str, Any] = {}
    phase = doc.get("phase")
    own_form = doc.get("intakeMode") == "form"
    history = _renamed(_history(doc))
    if phase in OLD_PHASES and not own_form and applications == 0:
        # A Google Form market that imported nothing (an absent mode reads as CSV): back to draft.
        change["phase"] = DRAFT
        change["isDraft"] = True
        form = doc.get("applicationForm")
        if isinstance(form, dict) and form.get("publishedAt"):
            change["applicationForm.publishedAt"] = None
        history = history + [{
            "phase": DRAFT,
            "enteredAt": datetime.now(timezone.utc).isoformat(),
            "by": None,
        }] if history else history
    elif phase in OLD_PHASES:
        change["phase"] = STAGE
        if phase in CLOSED_PHASES and own_form:
            change["applicationsStopped"] = True
    if history != _history(doc):
        change["phaseHistory"] = history
    return change


def migrate(db, dry_run: bool = False) -> Dict[str, int]:
    """Migrate every market, or say what would change. Returns the counts it printed."""
    markets = db.markets
    pending = list(markets.find({
        "$or": [
            {"phase": {"$in": list(OLD_PHASES)}},
            {"phaseHistory.phase": {"$in": list(OLD_PHASES)}},
        ],
    }))

    counts = {phase: 0 for phase in OLD_PHASES}
    counts.update({"stopped": 0, "to_draft": 0, "history_only": 0, "updated": 0})
    for doc in pending:
        held = db.applications.count_documents({"market_id": doc.get("id")})
        change = change_for(doc, held)
        if not change:
            continue
        phase = doc.get("phase")
        name = doc.get("name") or doc.get("id")
        if change.get("phase") == DRAFT:
            counts["to_draft"] += 1
            print(f"  ~ {name}: {phase} -> {DRAFT} (a Google Form market that imported nothing)")
        elif phase in OLD_PHASES:
            counts[phase] += 1
            stopped = " (not taking applications)" if change.get("applicationsStopped") else ""
            print(f"  - {name}: {phase} -> {STAGE}{stopped}")
        else:
            counts["history_only"] += 1
            print(f"  . {name}: {phase}, its phase history renamed")
        if change.get("applicationsStopped"):
            counts["stopped"] += 1
        if dry_run:
            continue
        result = markets.update_one({"_id": doc["_id"], "phase": phase}, {"$set": change})
        if result.matched_count:
            counts["updated"] += 1
        else:
            print(f"  ! {name}: moved while this ran; run it again")

    moved = sum(counts[phase] for phase in OLD_PHASES)
    verb = "Would move" if dry_run else "Moved"
    print(
        f"\n{verb} {moved} market(s) into {STAGE}: "
        + ", ".join(f"{counts[phase]} from {phase}" for phase in OLD_PHASES)
        + f"; {counts['stopped']} of them not taking applications."
    )
    print(f"{'Would return' if dry_run else 'Returned'} {counts['to_draft']} Google Form market(s) "
          "that imported nothing to draft, to wait for their first import.")
    print(f"{'Would rename' if dry_run else 'Renamed'} the phase history of "
          f"{counts['history_only']} market(s) in later phases.")
    if not dry_run:
        print(f"Updated {counts['updated']} market(s).")
    if not pending:
        print("Nothing to change: the migration has already run.")
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="Say what would change; write nothing")
    args = parser.parse_args()

    from db_config import get_database

    migrate(get_database(), dry_run=args.dry_run)


if __name__ == "__main__":
    main()
