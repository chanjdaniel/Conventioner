---
id: E02/F04
title: Remove the CSV substrate
type: feature
status: ready
blocked_by: [E02/F01, E02/F02, E02/F03]
pr: []
---

## Outcome

`source_data`, `col_names`, `col_values`, `col_include`, `enum_priority_order` and every `*_col_name_idx` are gone from the codebase, along with the `/source-data` endpoints, the collection behind them, and the front-end that still reads them.

Nothing in the product describes a vendor by spreadsheet position.

## Why now

This is what `AGENTS.md` has been calling Phase 5, and the reason it kept being deferred is that the solver depended on it.
F01 through F03 remove every live consumer, so the fields are dead weight the moment those land, and dead weight in this area is not harmless: it is a second spelling of data the product already holds, which is how the four-day ceiling and the silent priority rules survived as long as they did.

Left in place, the fields also keep inviting new readers.

## Shape

A trailing cleanup pass, deliberately not spread across the earlier features.
Each of F01 through F03 stops using the fields it no longer needs while the substrate stays present, so CI is green throughout the middle of the epic; this feature makes one considered cut.

Three surfaces come out, and they are not equally mechanical:

- **The `/source-data` endpoints and their collection.**
  Six API functions, their routes, the front-end calls, and the database initialisation and reset paths that create the collection.
- **The CSV-derived model fields**, on `SetupObject`, `PriorityObject`, `AssignmentOptionObject` and `MarketDateObject`.
  `docs/schema.d.ts` is generated from the contract models and must be regenerated, not hand-edited.
- **The front-end setup UI** that still renders columns, including the column-selection screen and the vendors views that read `col_names`.

## The check-in trap

`record_attendance()` builds its date aliases from `MarketDateObject.col_name`, and the solver resolves market dates through the same field.
`AGENTS.md` records both as the reason these fields were kept optional rather than deleted.

Public check-in is live behaviour on a public URL.
Removing `col_name` is therefore a check-in change, not only a solver change, and needs its own verification through the real check-in path rather than through a unit test of the alias builder.

## Notes

**The migration question is owed an answer here, not an assumption.**
Ticket 03 concluded there is nothing to migrate because nothing has shipped and there is no deployment, and explicitly deferred verification against a real database to this work.
Ticket 03 also asked that the same verification be done for `source_data` at the same time.
Do them together, and record what was found.

The e2e seeds fabricate source data to reach assignment today.
They are consumers like any other and come out here, which is also the clearest end-to-end proof that the native path works.
