---
layer: business
kind: rule
describes:
  - back-end/assignment/made_from.py#changed_since_run
  - front-end/src/utils/assignmentOutOfDate.ts
verified: 2026-10-22
sources:
  - E22/F03
  - E22/F03/S01
  - E22/F03/S02
---

# An assignment knows when it is out of date

A stored assignment says which of its inputs (the rules, the market plan, the approved applications) changed since it ran, as "Your rules and the approved applications changed since this assignment ran."
It says so only in `assignment`, the one phase in which running it again is possible.

## Why

Editing the rules, the plan or the approved applications never changes a stored assignment; only running it again does.
With the rules and the result on separate pages, an organizer could change a rule and read an assignment made under the old one without being told.
A notice the organizer cannot act on is noise, so no other phase shows one.

**A hand placement is not a change.**
Placing, freeing or swapping is an edit to the result, not an input, so it never makes an assignment out of date.

**An assignment older than the record is not stale.**
One made before runs recorded their inputs is not known to be out of date and is never shown as such, because a notice on every existing market would teach organizers to ignore it.

## Where it is kept

- What changed is decided by the server, from the fingerprints each run records: `changed_since_run` in [`back-end/assignment/made_from.py`](../../../back-end/assignment/made_from.py), served on the market as `assignmentOutOfDate` ([what an assignment was made from](../../implementation/modules/made-from.md)).
- Only a run records its inputs, and a hand edit leaves them alone: [placements](../../implementation/modules/placements.md).
- [`front-end/src/utils/assignmentOutOfDate.ts`](../../../front-end/src/utils/assignmentOutOfDate.ts) only words the groups, on the Result page's summary.
