---
id: E01/F01
title: Essential questions reshaped to the solver contract
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

The essential questions are exactly the answers the solver reads: seven of them, with availability and tier asked separately, table choice and an optional table-share partner added, and table type stubbed until the floorplan ships.

## Why now

This is prefactoring, and it comes before everything else in the epic.
The CSV import maps onto these questions and the solver reads them, so reshaping them first makes both of those changes easy instead of making them twice.

Governed by [ticket 01](../../../wayfinding/v0-1-0/issues/01-reconcile-essential-fields-with-solver.md), which also explains why the contract had drifted from the solver in both directions.

Shared with E02, which is why E02 is blocked by this epic.
