---
layer: implementation
kind: adr
describes:
  - back-end/datatypes.py#PriorityObject
  - back-end/datatypes.py#BUILT_IN_TARGET_PREFIX
verified: 2026-10-22
sources:
  - wayfinding/v0-1-0/03
  - E02
status: accepted
---

# A priority rule names a target

## Context

Priority decides who is placed first when demand exceeds tables.
It was expressed in spreadsheet columns: a rule carried a column index, a declared `data_type` (String, Number, Enum, Contains, Does not contain) and a sort order, and its ordering lived in `enum_priority_order`, a parallel array with one entry required per column.
The solver read none of the declared type: it looked the answer up in the parallel array and scored by position, so a rule declared as a number in ascending order scored every vendor alike and did nothing, silently.
With [applications as the solver's only input](0003-applications-are-the-solvers-only-input.md) there are no columns left to index.

## Decision

A rule (`PriorityObject` in [`back-end/datatypes.py`](../../back-end/datatypes.py)) names a **target** and carries its own **ordering**.

- The target is a key of one of the organizer's own form fields, or a built-in attribute of the application in the `application.` namespace (`application.submitted_at`, `application.application_type`).
  Form field keys are held to `^[a-z0-9_]+$`, so a key can never contain the dot and the two kinds can never collide.
- How to order follows from the target's type, and nothing is declared: a select or multi-select is ordered by arranging its answers (`ordering`, with `<All others>` standing for whatever is left out); a number, a date or a checkbox by picking an end (`direction`).
- There is no `data_type`.
  Adding one back would restore the silent no-op it replaced: a type declared on a field of another type.

Rejected: a closed vocabulary of criteria, because priority is exactly where markets differ, so the organizer names their own questions.
Rejected: implementing only arranged answers, because "first come, first served" is the commonest tie-break there is and no form question can supply when an application arrived.
Dropped: Contains and Does not contain, which are predicates sorting into two buckets, better asked as a checkbox.

## Consequences

- Rules apply in order, and a later rule only breaks a tie the earlier ones left ([priority and tie-breaks](../business/rules/priority-and-tie-breaks.md)).
- A rule over `application.submitted_at` decides something only when every application carries its real submission time, so a CSV import must map the form's timestamp.
- The rule editor offers the market's own select, multi-select, number, date and checkbox fields, under "Your questions", and the built-in attributes, under "About the application"; a free-text question is not offered, since it has nothing to arrange.
- The scoring is in [the assignment solver](../implementation/modules/assignment-solver.md).
