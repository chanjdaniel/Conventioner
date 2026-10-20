---
id: E34/F03/S01
title: A verdict is written only on what the reviewer saw
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

A verdict carries the status the reviewer saw, and is written only if the application still has it.
Otherwise nothing is written, and the reviewer is told who changed it and to what, with the application refreshed so they can decide again.

## Acceptance criteria

- [ ] Two verdicts on the same application from two sessions: the first is written, the second is refused and names the first's giver.
- [ ] A refused verdict leaves the reviewer on that application with its current status shown.
- [ ] Covered by a back-end test of the race and an E2E spec with two organizer sessions.
