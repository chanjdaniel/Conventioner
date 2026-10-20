---
id: E34/F03
title: Reviewers do not collide
type: feature
status: done
blocked_by: [E34/F01]
pr: []
---

## Outcome

Two reviewers working at once are never shown the same application to decide, and a verdict on an application someone else has changed since the reviewer opened it is refused, saying who changed it.

## Why now

Brain dump 2026-10-19: the last verdict silently wins, and two reviewers starting together walk the same cards in the same order.

## Stories

- `S01` - a verdict is written only on what the reviewer saw.
- `S02` - a reviewer holds the application they are looking at.
