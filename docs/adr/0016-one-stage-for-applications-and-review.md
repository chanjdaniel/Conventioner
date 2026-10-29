---
layer: implementation
kind: adr
describes:
  - back-end/guards.py#VALID_TRANSITIONS
  - back-end/datatypes.py#MarketPhase
  - back-end/migrations/migrate_to_one_stage.py
verified: 2026-10-29
sources:
  - E38/F04
  - E38/F04/S01
  - E38/F04/S02
  - E38/F04/S03
status: accepted
---

# One stage where applications arrive and are reviewed

The glossary concept: [Phase](../business/concepts/phase.md).

## Context

Between Draft and Assignment a market had three phases: `applications_open`, `applications_closed` and `review`.
None of them said what an organizer was doing.
Verdicts were open in all three, so a market whose vendors apply on its own page was reviewed while it was "open", and its "review" changed nothing but the name.
A Google Form market had no closed phase of its own: its organizer holds the responses before the market leaves draft, so its path stepped through `applications_closed` (E32/F02/S01), and its rail read Import and then Review over the same Applications tab, which offered the review's verdicts and an Import button at once.
Daniel's 2026-10-29 QC walk read that tab as the review with an import left over, and asked how the states could "converge so that it all can exist happily in one state": applications coming in and reviewing are one stage, which the import kicks off on the Google Form path, and which ends when the reviews are done.

## Decision

**One stored phase, `applications`, replaces the three**, in `MarketPhase` ([`back-end/datatypes.py`](../../back-end/datatypes.py)) and the transition table ([`back-end/guards.py`](../../back-end/guards.py)).
It is named by the intake path, never stored twice: "Review" on a Google Form market, "Applications" on one whose vendors apply on its page (`phase_label` on the server, `CSV_PHASE_LABELS` and `PHASE_LABELS` on the front end).

- **The way in differs by path; the phase does not.**
  An own-form market enters by Open Applications.
  A Google Form market enters by its first import: the move waits on `ResponsesImportedGuard`, whose fix is "Import responses", and the import runs in draft and takes the move through `take_move` once its rows are written, so leaving the import first keeps the market a draft and Market Setup settles at that moment.
- **The way out is Begin Assignment**, guarded by every application being decided, and it closes the applicant form: applying is the stage's alone.
  The way back to draft stays open while nobody has applied.
- **Stopping applications is a fact about the form, not a phase**: `applicationsStopped` on the market, set by "Stop taking applications" and "Take applications again" on the rail's More… (E38/F04/S02).
  While it is set the applicant form refuses in the words a closed market used, and reviewing goes on; the phase writer clears it on entering draft and on entering the stage, so a stop never outlives its stay.
- **A late Google Form export is a Redo import** under More…, which reads the whole responses file again while the market stays in Review (E38/F04/S03); the Applications tab offers no import on either path.
- **Every move is one edge again.**
  With no phase left to step through, `PASSED_THROUGH`, the two-step routes and `phasesPassedThrough` went, and the form amendment's walk down to draft and back went with them: a Google Form market reaches the import with no application only in draft, where its form is writable.
- [`migrations/migrate_to_one_stage.py`](../../back-end/migrations/migrate_to_one_stage.py) moved every market in the three phases into the stage, kept an own-form market whose applications had closed (in `applications_closed` or `review`) not taking applications, and renamed their phase history.

## Consequences

- The rail reads five stages on both paths, and its More… holds actions that are not moves beside the moves that are.
- Verdicts are open from the first application to Begin Assignment on both paths, as they already were; the phase gate on verdicts the walk first planned for the Google Form path was not built.
- The deploy that ships this runs the migration first: the build before it reads `applications` as an unknown phase, and this one the old three, and either degrades an unknown phase to archived, read-only ([`docs/RELEASING.md`](../RELEASING.md#pre-deploy-database-migrations)).

What the organizer meets of it: [the lifecycle](../business/flows/lifecycle.md), [taking applications](../business/flows/taking-applications.md), [reviewing applications](../business/flows/review.md) and [review needs an import](../business/rules/review-needs-an-import.md).

## Considered and rejected

- **Keeping `review` as the stored name**: no market would have moved, but an own-form market would store "review" while its organizer reads "Applications", and the code would read a review phase where vendors still apply.
- **Stopping applications as a phase of its own**: it is what `applications_closed` was, and a phase between two others that changes nothing about reviewing is the confusion this replaces (Daniel, round 3 of the walk: option b).
- **Verdicts closed until the import is done** on a Google Form market: superseded by the one stage, in which the import is what begins it.
