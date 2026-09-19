---
id: E11/F02/S01
title: The solver places around pinned vendors
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

A `VendorAssignmentResult` gains a flag marking it hand-placed.
`assign()` treats flagged rows as fixed: their seats are unavailable, their vendors are already
placed, and everyone else is placed around them.

A pinned vendor still counts against `max_assignments_per_vendor` and against the half-table
proportion, because they occupy a real seat on a real date.

There is no separate constraint object.
A pin **is** the placement row, which is why pinning before any solver run works with no extra
machinery: it writes a row early.

## Acceptance criteria

- [ ] A pinned placement survives a re-run unchanged, in `back-end/tests/test_assignment_behaviour.py`.
- [ ] The vendors placed around a pin are placed as the solver would have placed them with that seat
      simply occupied - no special case beyond availability.
- [ ] A pinned vendor counts toward their own assignment ceiling and the section proportion.
- [ ] Pinning with no assignment computed yet produces a valid assignment when Assign is first run.
