---
id: E02/F01
title: The solver reads Applications
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

`assign_market()` is handed approved `Application` records and assigns a market from them.
No caller fetches source data first, and the solver holds no column index, no column name, and no dynamic attribute lookup.

A market whose vendors arrived through CSV import is assignable end to end, with no fabricated CSV anywhere in the path.

## Why now

This is the slice that makes the intake redesign real.
Today every `assign_market()` call site fetches `SourceDataApi.get_source_data()` first, so a market created through the application path cannot be assigned at all, and the e2e seeds fabricate a CSV to reach assignment.

It is also the prerequisite for everything else in the epic: the priority rewrite and the section-preference work both address vendor fields, and neither can be expressed while a vendor is a bag of spreadsheet headings.

## Shape

Governed by [ticket 02](../../../wayfinding/v0-1-0/issues/02-solver-vendor-input-model.md), with the field set fixed by [ticket 01](../../../wayfinding/v0-1-0/issues/01-reconcile-essential-fields-with-solver.md).

A typed `SolverVendor` carrying the seven essential fields as named attributes, built by a dedicated translation module inside the solver package.
The solver package owns its own input contract, so the mapping is unit-testable without constructing a `MarketAssignment` or touching Mongo.

Only `reviewer_approved` applications feed the solver, which needs one new status-filtered query method on `ApplicationsApi`.
An application missing a required answer is rejected before the solver runs, as a precondition naming the offending applicants, rather than skipped into an assignment that looks complete with someone silently absent.

Three behaviour changes ride along, because the port forces each of them and a naive port gets each of them wrong:

- **Tier becomes a set-membership hard filter** over `essential_tier_preference`.
  It is currently a substring match against the per-date answer, so a tier named `A` matches an answer of `AB`.
  The per-date answer no longer carries tiers at all, so this cannot be deferred.
- **`max_assignments_per_vendor` is honoured and `MAX_VENDING_DAYS` is deleted**, including the duplicate in `validator.py`.
  The setting already exists, is already rendered and clamped in the UI, and is already persisted.
  The solver has never read it, so an organizer can set it to 6, watch it save, and get 4.
- **`date_flexibility` becomes the number of available dates.**
  It currently sums comma-separated tier tokens across dates, conflating how many days with how many tiers.

## Notes

`int(max_days_val[0])` truncates `"12"` to `1`.
The trap when retyping it: `essential_max_dates` is stored as an `int`, and `int(5)[0]` raises `TypeError`, which the surrounding bare `except` swallows into the global default.
A naive port replaces one wrong answer with a different wrong answer.

The dynamic-attribute surface is wider than the epic's note suggests.
`_get_vendor_rows()` is the only reader of `source_data`, but the accessor layer above it (`_vendor_field_at`, `_get_vendor_column_value`, `_mapped_col_idx`, and the six `*_col_name_idx` lookups) is around ninety lines.
All of it collapses into typed attribute reads.

`_get_column_values()` is dead code and also incorrect, indexing a row-major array by column index.
It comes out with the rest.

The CSV substrate itself is not deleted here.
Call sites stop using it and F04 removes it, so CI stays green through the middle of the epic.
