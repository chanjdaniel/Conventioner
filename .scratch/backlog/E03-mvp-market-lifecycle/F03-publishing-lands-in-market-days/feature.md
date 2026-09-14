---
id: E03/F03
title: Publishing lands in market_days
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

A published market is in `market_days`. `archived` means finished, and only that.

## Why now

Publishing fired `draft -> archived`, so `archived` meant both "live" and "over" - and
`CONTEXT.md` names phase as the single source of truth for the lifecycle. `market_days` already
existed and already meant this; it was stranded behind the deadlocked `assignment -> offers`.

Decided by
[ticket 06](../../../wayfinding/real-market-readiness/issues/06-is-published-a-phase.md).

## Shape

- Add `assignment -> market_days` to `VALID_TRANSITIONS`; Done fires it.
- Add an **assignment-computed entry invariant** on `market_days` in `PHASE_ENTRY_INVARIANTS`, not
  on the edge. It must check something the solver actually writes
  (`assignmentObject.vendorAssignments`) - `offers` is deadlocked precisely because its invariant
  checks something nothing sets.
- Keep `draft -> archived`; it means abandonment. The red Archive Market button becomes correct.
- Check-in (`published_market_by_slug`) serves `market_days`; applicant intake
  (`applicant_intake_market_by_slug`) narrows to `applications_open`.
- Plain migration moving already-published markets from `archived` to `market_days`, so they keep
  their check-in URL.
- Add **publish** and **market_days** to `CONTEXT.md`.
