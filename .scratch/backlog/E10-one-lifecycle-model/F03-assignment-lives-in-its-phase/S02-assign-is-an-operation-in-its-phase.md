---
id: E10/F03/S02
title: Assign runs in the assignment phase and nowhere else
type: story
status: done
blocked_by: []
pr: [73]
---

## What to build

`Assign` is available in the `assignment` phase, repeatable there, and unavailable in every other
phase.

The machine already expresses the surrounding rules and this story must not duplicate them:
`assignment` carries the entry invariant `_ALL_REVIEWED`, so "you may not assign before reviewing"
is already said once, server-side; `market_days` carries `_ASSIGNMENT_COMPUTED`, so "you must have
run it before you can publish" is already said too.
This story adds only the phase condition on the operation itself, and it belongs server-side as well
as in the UI - the endpoint is reachable directly and a hidden button is not a rule.

## Acceptance criteria

- [x] `Assign` is offered only in `assignment`, and says why when it is not.
- [x] The assignment endpoint refuses outside `assignment`, with a message naming what to do.
- [x] Re-running inside `assignment` is allowed and produces a fresh assignment.
- [x] No duplication of `_ALL_REVIEWED` or `_ASSIGNMENT_COMPUTED` in the new condition.

## Unblocked

`E11/F01/S01` (the placement endpoint) and `E11/F03/S01` (place and swap on the Tables view) have
both landed, so an organizer whose vendors drop out on the morning of the market changes a
placement by hand instead of archiving a running market.
The freeze shipped with them.
