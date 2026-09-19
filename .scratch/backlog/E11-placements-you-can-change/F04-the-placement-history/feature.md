---
id: E11/F04
title: The placement history
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

Anyone looking at a market can see who changed a placement, to what, and when.

## Why now

A placement that differs from what the solver produced is a fact someone will later ask about, and
a flag saying "hand-placed" cannot answer it.
There is no audit or history collection anywhere in this codebase, so this is new ground and its
scope is bounded deliberately: **placements only**.
