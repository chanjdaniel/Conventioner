---
id: E03/F03
title: Publishing lands in market_days
type: feature
status: done
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

## Verified

- `assignment -> market_days` with a stored assignment: **200**. Without one: **400**, blocker
  `assignment_computed`.
- The real-file market (333 placements) published, and its check-in page serves a vendor:
  *"Check in for Real File ... November 18, 2025, Table: Front Row1 (Full Table), Tier: Gold"*.
- A market abandoned `draft -> archived` does **not** resolve at its check-in URL, and cannot be
  pushed to `market_days` without an assignment.
- Migration: 7 published markets moved to `market_days`, 1 left `archived` because it carries no
  assignment.

## Two things this turned up

**The two public lookups could no longer be layered.** Applicant intake was built on top of the
check-in lookup, which was correct while both meant "non-draft". They now name different phases and
neither set contains the other, so `_market_by_slug` is one lookup parameterised by the phases its
caller serves. The Mongo filter still only prunes; `phase_from_market_document` still makes the call.

**A legacy market (no phase at all) is not served until it is migrated.** `phase_from_market_document`
maps `isDraft: false` to `archived`, which now means finished. Redefining that fallback to
`market_days` was tried and reverted: it rippled into `migrate_phase.py` and
`migrate_is_draft_consistency.py`, which both already define legacy-published as `archived`. Letting
the migration do the work keeps one definition. The failure is loud - the check-in URL 404s - which
is why neither migration refuses boot.
