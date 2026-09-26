---
id: E22/F02/S01
title: The plan write refuses a change to the assignment rules after the assignment phase
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

An organizer (or any client) who saves the plan after the market has left `assignment` cannot change the assignment rules through it: the priority, the max assignments per vendor, or the max half-table proportion.
The refusal names why: the assignment is settled, and a rule only takes effect when the assignment is run, which it can no longer be.

The plan still saves as the organizer types in every phase, and it always sends the rules it holds, so **restating the stored rules is not a change** - the same shape as the intake mode, which the plan write already refuses to change after draft while accepting it restated.
"After `assignment`" is derived from the stored phase, not from a list of late phases, as the intake-mode refusal is.

## Acceptance criteria

- [x] In every phase after `assignment`, a plan write that changes any assignment rule is refused with a reason naming the settled assignment, and stores nothing.
- [x] In the same phases, a plan write that restates the stored rules and changes something else in the plan succeeds.
- [x] Up to and including `assignment`, the rules save as they do today.
- [x] Pinned by pytest beside the existing plan-write tests.
