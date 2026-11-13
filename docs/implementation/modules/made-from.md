---
layer: implementation
kind: module
describes:
  - back-end/assignment/made_from.py
verified: 2026-11-14
sources:
  - wayfinding/the-assignment-tab/03
  - E22/F03
  - E22/F03/S01
  - E22/F03/S02
  - E22/F02/S01
  - E27
  - E34/F05/S01
  - E27/F01/S01
  - T207
  - T263
  - T277
  - T316
---

# What an assignment was made from

[`back-end/assignment/made_from.py`](../../../back-end/assignment/made_from.py) records what a solver run read, and says which of it has changed since.
Editing the rules, the plan or the approved applications never changes a stored assignment; only running it again does.
With the rules and the result on separate pages, an organizer could change a rule and read an assignment made under the old one without being told.
Since T207 a run also records the review it stands on, so Back to review makes the stored run out of date ([ADR 0021](../../adr/0021-the-review-reopens-until-results-are-published.md)).

## Its interface

- `fingerprint(plan, vendors, phase_history)`: one fingerprint per group the run stands on, `("rules", "plan", "applications", "review")` (`GROUPS`).
  The rules are the priority and the assignment options; the plan is the dates (as a sorted set, so the order they were clicked is no change), tiers, locations and sections, without floorplans; the applications are the approved applications as `SolverVendor`s, sorted by application.
  Each of those three is a SHA-256 digest.
  The review is the count itself, as a string: how many times the market's [phase record](phase-record.md) has entered the review stage.
- `changed_since_run(market)`: the groups that differ now from `assignmentObject.madeFrom`, in `GROUPS` order.
- `review_reopened_since_run(market)`: whether the `review` group alone differs; the go-live guard `assignment_after_review` asks it ([the guards](guards.md)).
- `assignment_rules(plan)`: the rules in one comparable shape, which the plan write also reads to tell a change to the rules from a restatement: to settled rules, which it refuses ([the assignment rules close with the assignment](../../business/rules/the-assignment-rules-close-with-the-assignment.md)), and to any rules, which asks the Assignment row ([the market's actions](market-actions.md)).
  A market with no plan yet holds the rules a new plan starts with, no priority and `AssignmentOptionObject`'s defaults, so a first plan that keeps them changes no rule; no run is made without a plan, so no stored fingerprint read the old shape.

## Sharp edges

**This is the ONE place a fingerprint is computed.**
The run ([placements](placements.md), `run_assignment`) and the read (`GET /markets/:id`, served as `assignmentOutOfDate`) both call `fingerprint`, so they can never disagree about what "the same" means.

**Only a solver run writes `madeFrom`**, save the migration's legacy marker below.
A hand placement, a freed seat or a swap is an edit to the result, never an input, so it leaves the fingerprints alone and never makes an assignment out of date.
So does a change to how the solver scores what it reads (a multi-select answer scored by its best choice, E34/F05/S01): no input moved, so a stored run is not out of date, and running it again is the organizer's choice.

**An assignment with no fingerprints is served as not out of date, never as stale.**
One made before the fingerprints existed is not known to be out of date, and a notice on every existing market would teach organizers to ignore it.
Since T316 a run must record what it was made from, so the migration gives such an allocation `{"legacy": "before-fingerprints"}` (`LEGACY_MADE_FROM`, [the assignment's lifecycle](assignment-lifecycle.md)), which holds no group of `GROUPS` and so is compared on none.
An assignment with no placements is likewise never out of date.

**An incomplete approved application counts as a change.**
The read takes in the applications the run would refuse as well, so approving one with an answer missing shows as a change to the applications rather than hiding behind the run's refusal.

**The review group counts entries into the stage, not entries in the record.**
An old stage name (`applications_open`, `applications_closed`, `review`) is the stage, and a walk through the old stage's phases is one entry.
A record begun partway through a market's life opens with the phase the market was already in, counted like any other entry.
Only Back to review can move the count while a run is stored, since a run is made only in `assignment`.
It moves whether or not a verdict changed: the run was made before the review it now stands on.

**A group the run did not record is not compared.**
A run recorded before the `review` group existed is not known to be out of date by it; a real change of verdict still shows through `applications`.

**`review_reopened_since_run` reads no application**: only the phase record and the run's record of it, so the go-live guard that asks it stays cheap and never refuses a market for a plan or rule edit.

**A field added to `SolverVendor` changes every stored fingerprint** unless `_ADDED_SINCE_FINGERPRINTS` names it with the value that means "nothing" (`table_share_also` is there, E27), and every stored assignment would then read as out of date.

**The read is computed only in `assignment`**, the one phase that can act on it by running again; every other phase's read is served `[]` and spared reading the approved applications.
The served `allocation` judges a run `stale` by this list in `assignment`, and in `applications` by `review_reopened_since_run` alone ([the assignment's lifecycle](assignment-lifecycle.md)).

## Why

- [An assignment knows when it is out of date](../../business/rules/an-assignment-knows-when-it-is-out-of-date.md).
- [The assignment rules close with the assignment](../../business/rules/the-assignment-rules-close-with-the-assignment.md): the rules' shape is compared here.
- [Publish results waits for the allocation](../../business/rules/publish-results-waits-for-the-allocation.md): results are published only while the stored run is current by these fingerprints, as [the assignment's lifecycle](assignment-lifecycle.md) reads them.
- [ADR 0021](../../adr/0021-the-review-reopens-until-results-are-published.md): the `review` group, which keeps a run made before Back to review from being published or going live.

The organizer reads it as the Assignments page's out-of-date note ([J5](../../business/flows/assignment-and-result.md#j5-the-result-is-out-of-date)).

The glossary concept it serves: [Assignment](../../business/concepts/assignment.md).
