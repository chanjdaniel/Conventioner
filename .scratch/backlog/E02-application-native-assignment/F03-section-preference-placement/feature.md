---
id: E02/F03
title: Section preference honoured in placement
type: feature
status: ready
blocked_by: [E02/F01]
pr: []
---

## Outcome

A vendor's ranked section preference influences where they are placed.
When a vendor can go in several sections, they get their highest-ranked one still available.

## Why now

`essential_section_ranking` has been collected since the essential-fields contract shipped and has never been read by anything.
F01 puts it on `SolverVendor` but changes no placement behaviour, so without this feature the epic ends with the solver holding a field it still ignores.

## Shape

Governed by [ticket 01](../../../wayfinding/v0-1-0/issues/01-reconcile-essential-fields-with-solver.md).

Preference is honoured as **placement preference**: not an optimisation objective, and not a tie-break.
No vendor goes unassigned merely because a preferred section filled up.

This follows necessarily from rankings being total.
A ranking is a permutation of the whole offering, so it excludes nothing and therefore cannot act as a filter.
Contrast tier, which F01 makes a hard filter, because the tier determines the price the applicant pays.

No new data is needed.
`Table` already carries its `SectionObject`.

## Why it is its own feature

The solver is table-driven: it walks tables and picks the highest-priority valid vendor for each.
Honouring a vendor's own section ranking requires that ranking to influence which table they reach, which means inverting that loop or adding a pre-pass.

Expect existing assignment outputs to move and solver tests to churn.
That is the whole reason this is separated from F01: bundled together, an output diff is ambiguous between "we changed where the data comes from" and "we changed how placement decides".
Kept apart, F01's diff should be empty of placement changes and this one's should be entirely placement changes.

## Notes

Table type is stubbed to a single hard-coded type for the MVP, and `essential_table_type_ranking` is not asked while fewer than two types exist.
That is a deliberate stub, not an oversight: the field and the solver's handling of it stay in place, and only a real offering is missing until the floorplan GUI ships.
Do not treat the stub as a second preference to wire up here.
