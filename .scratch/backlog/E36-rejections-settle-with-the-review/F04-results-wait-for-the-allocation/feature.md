---
id: E36/F04
title: Results wait for the allocation
type: feature
status: done
blocked_by: [E36/F01]
pr: []
---

## Outcome

On a form market, Publish Results is the step after a current run, and it settles the run: the assignment is not re-run after it, and the market does not go live without it.

## Why now

Publish Results worked from applications open, from the first verdict, so every later verdict reached applicants at once (research 6.3).
A market could also go live, with check-in on the air, without results ever being published, and on an out-of-date run (state review conflicts 2, 6, 7).
Decisions 8-11.

## Stories

- `S01` - Publish Results waits for a current run.
- `S02` - publishing settles the assignment.
