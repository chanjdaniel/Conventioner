---
id: E26/F05/S01
title: Check-in reads the stored assignment
type: story
status: proposed
blocked_by: []
pr: []
---


## What to build

The public check-in lookup describes the stored assignment, including every swap, placement and freed seat, and never runs the solver.

Closes bugs 1 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [ ] After a swap, a placement into an empty seat and a freed seat, each affected vendor's check-in shows the stored seat.
