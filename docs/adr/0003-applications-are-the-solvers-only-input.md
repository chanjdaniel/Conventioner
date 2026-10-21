---
layer: implementation
kind: adr
describes:
  - back-end/assignment/vendor_input.py#SolverVendor
  - back-end/assignment/vendor_input.py#solver_vendors_from_applications
verified: 2026-10-22
sources:
  - wayfinding/v0-1-0/map
  - wayfinding/v0-1-0/02
  - E02
status: accepted
---

# Applications are the solver's only input

The glossary concepts: [Application](../business/concepts/application.md) and [Assignment](../business/concepts/assignment.md).

## Context

The solver began as a tool over an uploaded spreadsheet.
`MarketAssignment` took the plan and `source_data`, a two-dimensional array with headings in its first row; each row became a vendor whose attributes were set from the headings, and every later read was a `getattr` by a name derived from a heading.
The plan addressed its columns by index (`col_names`, `col_name_idx`, `enum_priority_order`), and each placement was dated by a column heading.
That shape has no failure signal: a renamed, mistyped or absent heading reads as an empty answer, and the market assigns oddly with nothing raised.

Once vendors could apply through the product and be imported from a Google Form as applications, the spreadsheet was a second record of the same people.

## Decision

The solver reads the market's own approved applications, and nothing else.
There is no spreadsheet behind a market: `source_data`, its endpoints and its collection, and every column reference in the plan, are deleted.

Each approved application is translated into a typed, frozen `SolverVendor` by one module inside the solver package, [`back-end/assignment/vendor_input.py`](../../back-end/assignment/vendor_input.py) (`solver_vendors_from_applications`).
The solver owns what it needs from an application; application storage carries no solver knowledge.
Rejected: a translation inside the applications API, which would put solver knowledge in storage, and a method on `MarketAssignment`, which could be tested only through the solver.

An approved application missing an answer the market asked refuses the whole run, naming the applicants, rather than being skipped.

## Consequences

- `assign_market(market)` needs nothing fetched first; tests pass `SolverVendor`s in directly and describe a market with no database.
- **An application is the one record of a vendor**, however they arrived: an imported row and an online application are written alike and carry the same review state, so the solver never asks how a vendor came in.
- A wrong field name is an `AttributeError`, not a blank; the number of dates wanted is an `int`, not a string whose first character was read; availability is a set.
- An import is the only way a Google Form's responses reach the solver, so everything the solver reads must be something an application can carry: [essential fields are exactly what the solver reads](0001-essential-fields-are-the-solver-contract.md).
- A placement is dated by the market date itself, and the maps from headings back to dates are gone.
- A priority rule could no longer address a column, so it names a target ([a priority rule names a target](0004-a-priority-rule-names-a-target.md)).
- The solver, its seam and its sharp edges are [the assignment solver](../implementation/modules/assignment-solver.md); the refusal is [an incomplete application refuses the run](../business/rules/an-incomplete-application-refuses-the-run.md).
