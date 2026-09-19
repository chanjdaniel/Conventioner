---
id: E10/F04
title: The machine decides which transitions confirm
type: feature
status: in-progress
blocked_by: []
pr: []
---

## Outcome

A transition confirms when it cannot be undone, derived from the transition table rather than
hard-coded, and every confirmation says what actually happens.

## Why now

The policy the product already has is right - `market_days` and `archived` confirm, nothing else
does, and those are exactly the two edges with no route back.
It is hard-coded in `handleTransitionClick`, so it will drift the moment the table changes.
And the one confirmation an MVP organizer will ever meet describes a feature MVP does not have.
