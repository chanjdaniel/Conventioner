---
id: E26/F05/S02
title: Orphaned pins are flagged and block publishing
type: story
status: proposed
blocked_by: []
pr: []
---


## What to build

A pin on a table the plan no longer has is marked on Result and the vendor's panel, and Publish Market is refused until it is moved or freed.

Closes bugs 31 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [ ] An orphaned pin shows a marker on Result and the vendor panel.
- [ ] Publish Market is refused, naming the vendor, table and date.
