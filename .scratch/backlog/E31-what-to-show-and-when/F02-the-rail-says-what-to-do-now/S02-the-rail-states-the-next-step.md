---
id: E31/F02/S02
title: The rail states the next step, from one table
type: story
status: ready
blocked_by: [E31/F02/S01]
pr: []
---

## What to build

One front-end table, keyed by phase and intake path (with "has a stored run" for assignment), gives the rail's statement, the page it links to, and each tab's state and line.
It is [ticket 02's answer](../../../wayfinding/what-to-show-and-when/issues/02-the-next-step-per-phase-and-path.md#answer), and `currentPage` becomes a reading of it rather than a second source.
The rail shows the statement beside the forward step on every market screen; when the forward step has a blocker, the statement is that blocker, linking to where it is fixed.

## Acceptance criteria

- [ ] Every phase on each path shows the statement ticket 02 gives, linking to its page.
- [ ] With a blocker, the statement names it and links to its fix.
- [ ] A unit test fails if a phase in `phaseSpine()` has no row for either path.
