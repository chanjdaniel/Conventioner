---
id: E10/F04/S01
title: Confirmation is derived from the transition table
type: story
status: in-progress
blocked_by: []
pr: [71]
---

## What to build

A transition asks for confirmation when its target phase has no outbound route back, computed from
`VALID_TRANSITIONS` rather than listed in `handleTransitionClick`.

Today that yields exactly the current set: `archived` has no outbound edges at all, and
`market_days` reaches only `archived`.
Everything else has a documented reverse edge and fires on one click, which is correct.
The point of deriving it is that it stays correct when the table changes - the same reason
`_validate_registry()` refuses a table that disagrees with itself at import.

## Acceptance criteria

- [ ] `handleTransitionClick` names no phase; it asks the table.
- [ ] `market_days` and `archived` still confirm; nothing else does.
- [ ] Adding a reverse edge to the table stops that transition confirming, without touching the
      component. A unit test pins this.
