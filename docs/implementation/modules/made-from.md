---
layer: implementation
kind: module
describes:
  - back-end/assignment/made_from.py
verified: 2026-10-22
sources:
  - E22/F03
  - E22/F03/S01
  - E22/F03/S02
  - E22/F02/S01
  - E27
---

# What an assignment was made from

[`back-end/assignment/made_from.py`](../../../back-end/assignment/made_from.py) records what a solver run read, and says which of it has changed since.
Editing the rules, the plan or the approved applications never changes a stored assignment; only running it again does.
With the rules and the result on separate pages, an organizer could change a rule and read an assignment made under the old one without being told.

## Its interface

- `fingerprint(plan, vendors)`: one SHA-256 digest per group the solver reads, `{"rules", "plan", "applications"}` (`GROUPS`).
  The rules are the priority and the assignment options; the plan is the dates (as a sorted set, so the order they were clicked is no change), tiers, locations and sections, without floorplans; the applications are the approved applications as `SolverVendor`s, sorted by application.
- `changed_since_run(market)`: the groups that differ now from `assignmentObject.madeFrom`, in `GROUPS` order.
- `assignment_rules(plan)`: the rules in one comparable shape, which the plan write also reads to tell a change to settled rules from a restatement ([the assignment rules close with the assignment](../../business/rules/the-assignment-rules-close-with-the-assignment.md)).

## Sharp edges

**This is the ONE place a fingerprint is computed.**
The run ([placements](placements.md), `run_assignment`) and the read (`GET /markets/:id`, served as `assignmentOutOfDate`) both call `fingerprint`, so they can never disagree about what "the same" means.

**Only a solver run writes `madeFrom`.**
A hand placement, a freed seat or a swap is an edit to the result, never an input, so it leaves the fingerprints alone and never makes an assignment out of date.

**An assignment with no fingerprints is served as not out of date, never as stale.**
One made before the fingerprints existed is not known to be out of date, and a notice on every existing market would teach organizers to ignore it.
An assignment with no placements is likewise never out of date.

**An incomplete approved application counts as a change.**
The read takes in the applications the run would refuse as well, so approving one with an answer missing shows as a change to the applications rather than hiding behind the run's refusal.

**A field added to `SolverVendor` changes every stored fingerprint** unless `_ADDED_SINCE_FINGERPRINTS` names it with the value that means "nothing" (`table_share_also` is there, E27), and every stored assignment would then read as out of date.

**The read is computed only in `assignment`**, the one phase that can act on it by running again; every other phase's read is served `[]` and spared reading the approved applications.

## Why

- [An assignment knows when it is out of date](../../business/rules/an-assignment-knows-when-it-is-out-of-date.md).
- [The assignment rules close with the assignment](../../business/rules/the-assignment-rules-close-with-the-assignment.md): the rules' shape is compared here.
- [Publish Results waits for the allocation](../../business/rules/publish-results-waits-for-the-allocation.md): results are published only while the stored run is current by these fingerprints.
