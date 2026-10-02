---
id: E26/F06/S01
title: Archived markets are read only
type: story
status: done
blocked_by: []
pr: []
---


## What to build

Every write to an archived market is refused by the server, and its pages offer no editing controls.

Closes bugs 30 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] Plan, form, placement and review writes to an archived market are refused.
- [x] Archived market pages show no editing controls, and no Attendance tab for a market that never ran.
