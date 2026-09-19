---
id: E12/F03/S02
title: An asked-for tier with no tables blocks assignment
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

A guard on `-> assignment`: refuse when an **approved** application names a tier the plan gives no
tables to.

An empty tier nobody asked for stays harmless and does not block.
An empty tier five approved applicants asked for is five guaranteed rejections, and without this the
organizer presses Assign and finds out afterwards.

This is an entry in `guards.py` and nothing new in the UI - the transition endpoint and
`BlockerPanel` are already generic over `PreconditionResult`, and `_validate_registry()` will refuse
the table at import if the entry is malformed.

The message names the tier and the applicants, so the organizer can either add a section at that
tier or reject those applications - both of which are one screen away.

## Acceptance criteria

- [ ] An approved application naming a tier with no sections blocks `-> assignment`.
- [ ] An empty tier that no approved application names does not block.
- [ ] Rejecting those applications clears the blocker; so does adding a section at that tier.
- [ ] The message names the tier and the applicants, not a count alone.
- [ ] Covered in the guard tests, which already exist for every other edge.
