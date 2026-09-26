---
id: E22/F02/S02
title: The assignment rules read as settled after the assignment phase
type: story
status: ready
blocked_by: [E22/F02/S01]
pr: []
---

## What to build

An organizer who opens the assignment rules after the market has left `assignment` sees them as they were run, read-only, with one line saying why: the assignment is settled, and changing one placement is done on the result.

Up to and including `assignment` the rules stay editable, as today.
The page mirrors the server's refusal (`S01`) rather than being the rule.

## Acceptance criteria

- [ ] After `assignment`, priority rules and assignment options are shown but cannot be edited, and a line says why.
- [ ] Up to and including `assignment`, they are editable.
- [ ] The phase comes from the market the screen holds, so a transition from the rail changes it at once, without leaving the tab.
- [ ] Pinned by an e2e spec that walks a market from `assignment` to `market_days` with the tab open.
