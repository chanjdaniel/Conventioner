---
id: E34/F03/S02
title: A reviewer holds the application they are looking at
type: story
status: ready
blocked_by: [E34/F03/S01]
pr: []
---

## What to build

Opening an application in the one-by-one review places a claim on it, renewed while it stays open and released on a verdict, on moving on, or after five idle minutes.
Moving to the next application asks the server for the next undecided one nobody else holds, so two reviewers walk different cards.
An application another reviewer holds says so ("Alex is looking at this") wherever it is listed.
A claim never refuses a verdict on its own: `S01` is what keeps verdicts consistent.

## Acceptance criteria

- [ ] Two reviewers pressing Next together are shown different applications.
- [ ] A claim lapses five minutes after its holder stops, and the application is offered again.
- [ ] A held application shows its holder in the bulk view.
