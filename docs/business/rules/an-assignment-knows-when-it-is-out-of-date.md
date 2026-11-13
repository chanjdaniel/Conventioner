---
layer: business
kind: rule
describes:
  - back-end/assignment/made_from.py#changed_since_run
  - front-end/src/utils/assignmentOutOfDate.ts
verified: 2026-11-14
sources:
  - wayfinding/the-assignment-tab/03
  - E22/F03
  - E22/F03/S01
  - E22/F03/S02
  - T207
  - T277
  - T316
---

# An assignment knows when it is out of date

A stored assignment says which of its inputs (the rules, the market plan, the approved applications) changed since it ran, as "Your rules and the approved applications changed since tables were allocated."
It says so only in `assignment`, the one phase in which running it again is possible.
After Back to review it also says, in a sentence of its own ahead of that one, "The review was reopened after tables were allocated.", whether or not a verdict changed.

**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md) and [Results go out once, and settle the allocation](../intents/results-go-out-once-and-settle-the-allocation.md).

## Why

Editing the rules, the plan or the approved applications never changes a stored assignment; only running it again does.
With the rules and the result on separate pages, an organizer could change a rule and read an assignment made under the old one without being told.
A notice the organizer cannot act on is noise, so no other phase shows one.

**It names what changed**, so the organizer knows what the run would now answer differently rather than that something did.
**It is a fact, not an error**: a quiet note with no dismiss, cleared only by running again.

**A reopened review is a change, said apart.**
The tables were allocated before the review the market now stands on, so they must be allocated again before results are published or the market goes live ([ADR 0021](../../adr/0021-the-review-reopens-until-results-are-published.md)).
The review is no input that "changed", so it has its own sentence rather than a place in the list.

**A hand placement is not a change.**
Placing, freeing or swapping is an edit to the result, not an input, so it never makes an assignment out of date.

**An assignment older than the record is not stale.**
One made before runs recorded their inputs is not known to be out of date and is never shown as such, because a notice on every existing market would teach organizers to ignore it.
It records a legacy marker in place of its inputs, which names none of them, so it reads as current ([the assignment's lifecycle](../../implementation/modules/assignment-lifecycle.md)).

## Where it is kept

- What changed is decided by the server, from the fingerprints each run records: `changed_since_run` in [`back-end/assignment/made_from.py`](../../../back-end/assignment/made_from.py), served on the market as `assignmentOutOfDate` ([what an assignment was made from](../../implementation/modules/made-from.md)).
- Only a run records its inputs, and a hand edit leaves them alone: [placements](../../implementation/modules/placements.md).
- Whether the stored run is out of date at all is the served `allocation`, `stale`, which Publish results is refused on ([the assignment's lifecycle](../../implementation/modules/assignment-lifecycle.md)).
- [`front-end/src/utils/assignmentOutOfDate.ts`](../../../front-end/src/utils/assignmentOutOfDate.ts) only words the groups, on the Assignments page's summary, and only while the served `allocation` is `stale`, so the notice and Publish results never disagree.
- The reopened review is counted from the market's phase record, the `review` group ([what an assignment was made from](../../implementation/modules/made-from.md)).
