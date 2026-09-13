---
id: E02/F02
title: Priority rules without columns
type: feature
status: ready
blocked_by: [E02/F01]
pr: []
---

## Outcome

An organizer builds their priority rules by naming their own form questions and a small set of built-in application attributes, and every rule they configure actually changes the assignment order.

`PriorityObject` no longer carries a column index, a data type, or a sorting order, and `SetupObject.enum_priority_order` is gone.

## Why now

Priority decides who gets placed first when demand exceeds tables, and it is expressed entirely in CSV columns: a rule addresses `col_names` by index, and its ordering lives in a parallel array with one entry required per column.
Deleting `col_names` deletes the addressing scheme the whole configuration is built on, so this cannot outlive F01.

It is also the epic's genuinely hard part.
The input model is a mechanical port; this is a redesign.

## Shape

Governed by [ticket 03](../../../wayfinding/v0-1-0/issues/03-priority-system-rewrite.md).

A rule names a target and an ordering, and the ordering's shape is derived from the target's type rather than declared alongside it.
A target is either a custom form field key or one of a small set of built-in application attributes.

`submitted_at` is why built-in attributes exist at all.
First come, first served is probably the most common tiebreaker there is, and no form question can supply it, so a field-only design would force organizers to fake it with a "what time is it" question.

Supported orderings are ordered options, number, date, and boolean, all derived from `FormField.type`.
The `<All others>` token stays, so an organizer need not enumerate every value of a select.

Two of the five data types the UI advertises are removed rather than implemented.
`Contains` and `Does not contain` are predicates, not orderings: they sort into two buckets, which a checkbox field expresses more honestly.

## Why the UI is in scope

The existing priority screen writes exactly the three fields this feature deletes.
Leaving it alone would ship a setup screen that cannot save, so the target picker lands with the model.

It is also where the current silence is most visible.
The screen renders a data-type dropdown the solver reads nothing from, so a rule configured as `Number` and `Ascending` scores every vendor identically and does nothing, with no error and no warning.
Deriving the ordering from the target makes that state unrepresentable rather than merely discouraged.

## Notes

**`submitted_at` must hold real submission time, not import time.**
It is optional, and if every CSV-imported row carries the import timestamp then they are all identical and first-come-first-served silently does nothing for exactly the markets this MVP serves.
E01 owns how the organizer maps the Google Forms `Timestamp` column; this feature owns the requirement that the value be real, and should assert it.

The only priority configurations that exist anywhere are in `tests/`.
Nothing has shipped and there is no deployment, so there is nothing to migrate, subject to the verification F04 owns.
