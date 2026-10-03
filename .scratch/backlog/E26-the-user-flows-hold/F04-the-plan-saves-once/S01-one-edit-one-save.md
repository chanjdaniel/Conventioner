---
id: E26/F04/S01
title: One edit, one save
type: story
status: done
blocked_by: []
pr: [88]
---


## What to build

The plan saves once per edit and stops, on Market Setup and on the Assignment page, so a second editor's change survives.

Closes bugs 25 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] After one edit, exactly one save is sent.
- [x] A location added in a second tab survives while the first tab stays open.
