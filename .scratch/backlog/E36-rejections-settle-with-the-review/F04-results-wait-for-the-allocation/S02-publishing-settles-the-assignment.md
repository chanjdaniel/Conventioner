---
id: E36/F04/S02
title: Publishing settles the assignment
type: story
status: done
blocked_by: [E36/F04/S01]
pr: [#116]
---

## What to build

Once results are published, the assignment is not re-run: Assign is refused with a reason, and seats change only by hand (decision 10).
The assignment rules (priority, ceiling, half-table share) lock with it, on the plan write and on the page.
A form market cannot go live until its results are published: one more guard on the move to market days, its own blocker line on the rail (decision 11).
A CSV market goes live as today.

## As built

- `assign_refusal` (served as `assignRefusalReason`), the published lock in `assignment_rules_lock_reason`, and `ResultsPublishedGuard` as an entry invariant on `market_days`.
- The market journey spec walks a CSV market, which goes live without publishing, so it is unchanged; `results-wait-for-the-allocation.spec.ts` walks the form path to market days.

## Acceptance criteria

- [x] After publishing, a run is refused with a reason, and placing, freeing and swapping by hand still work.
- [x] After publishing, a change to the assignment rules is refused, and the page draws them read-only.
- [x] A form market with results unpublished cannot move to market days, and the rail says why before the click.
- [x] A CSV market moves to market days without publishing.
- [x] The market journey spec publishes before going live.
