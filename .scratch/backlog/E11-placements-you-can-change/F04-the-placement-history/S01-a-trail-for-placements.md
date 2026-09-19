---
id: E11/F04/S01
title: A trail for placements
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

A record of placement changes on a market: who, what, when.
Read per-vendor on the vendor detail panel and per-market as a log.
Kept with the market, not beyond it.

**A solver run is one entry**, not none and not one per placement - "Assignment run by Dana, 47
placements written, 3 pins preserved".
Omitting runs leaves the trail lying by omission, because a placement that changed between two hand
edits would have no explanation.
One entry per placement would drown the hand edits under machine rows, and the hand edits are the
entries anyone actually reads.

Scope is placements and nothing else.
Phase transitions, plan edits and form edits are out; review verdicts already have their own record
in the application's status.

## Acceptance criteria

- [x] A hand placement, a swap and a solver run each produce exactly one entry.
- [x] Each entry names the organizer, the change and the time.
- [x] The vendor panel shows that vendor's entries; the market shows all of them.
- [x] Deleting a market takes its history with it.

## Notes

**Deliberate, not incidental:** recording *who* attaches an organizer's identity to a market that may
be exported, shared, or handed to a successor organizer.
That privacy surface was weighed and accepted when this was decided; do not widen it without
revisiting that.
