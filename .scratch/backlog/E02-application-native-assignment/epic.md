---
id: E02
title: Application-native assignment solver
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

The assignment solver reads `Application` records directly.
`source_data`, `col_names`, and every `*_col_name_idx` are gone from the codebase, along with the `/source-data` endpoints and the CSV-derived fields on `SetupObject`, `PriorityObject`, `AssignmentOptionObject`, and `MarketDateObject`.

## Why now

The solver is the reason the intake redesign is currently a facade: a market created through the application path cannot be assigned, because `assign_market()` is only ever called with `SourceDataApi.get_source_data()`.
Until this lands, every intake path has to fabricate a CSV to reach assignment - which is exactly what the e2e seeds do today.

This is what `AGENTS.md` has been calling "Phase 5". Charting resolved it rather than deferring it again, on the evidence that the solver's live contact with the CSV shape is a single 15-line method.

## Why it is smaller than it looks

`_get_vendor_rows()` (`assignment.py:327-341`) is the only live consumer of `source_data`, called once from line 242.
`_get_column_values()` (line 321) is dead code and also incorrect - it indexes a row-major array by column index - and comes out with the rest.

The genuinely hard part is not the input model but the priority system, which addresses its targets by column index into a parallel array.

## Decisions

All settled. Read these before writing stories:

- [01: Reconcile the essential-fields contract with the solver's inputs](../../wayfinding/v0-1-0/issues/01-reconcile-essential-fields-with-solver.md) - the seven fields, tier filtering versus section preference, the table-type stub.
- [02: The solver's native vendor input model](../../wayfinding/v0-1-0/issues/02-solver-vendor-input-model.md) - typed `SolverVendor`, where translation lives, and the two defects to fix in the same work.
- [03: What replaces the column-indexed priority system?](../../wayfinding/v0-1-0/issues/03-priority-system-rewrite.md) - rules address a field key or a built-in attribute; `data_type` and `enum_priority_order` are deleted.

**Keep the loop inversion in its own slice.** Honouring section preference means inverting the table-driven assignment loop and will move existing assignment outputs; bundling it with the input-model change makes any output diff ambiguous between the two causes.
