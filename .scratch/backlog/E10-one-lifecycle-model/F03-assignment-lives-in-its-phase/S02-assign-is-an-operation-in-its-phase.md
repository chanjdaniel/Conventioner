---
id: E10/F03/S02
title: Assign runs in the assignment phase and nowhere else
type: story
status: blocked
blocked_by: []
pr: []
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

- [ ] `Assign` is offered only in `assignment`, and says why when it is not.
- [ ] The assignment endpoint refuses outside `assignment`, with a message naming what to do.
- [ ] Re-running inside `assignment` is allowed and produces a fresh assignment.
- [ ] No duplication of `_ALL_REVIEWED` or `_ASSIGNMENT_COMPUTED` in the new condition.

## Blocked

On **`E11` Placements you can change** - specifically `E11/F01/S01` (the placement endpoint) and
`E11/F03/S01` (place and swap on the Tables view).
The decision is settled;
[ticket 08](../../../wayfinding/readable-journey/issues/08-where-a-manual-placement-lives.md) is
resolved.
What remains is the build: shipping the freeze before an organizer can hand-fix a placement strands
them on market day with archiving a running market as their only move.
This is the whole reason the story is `blocked` rather than `ready`.
