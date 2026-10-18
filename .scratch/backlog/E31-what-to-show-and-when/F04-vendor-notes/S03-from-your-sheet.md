---
id: E31/F04/S03
title: A sheet's organizer column comes in as "From your sheet"
type: story
status: in-progress
blocked_by: [E31/F04/S02]
pr: []
---

## What to build

The import offers an organizer's own column (which the form started from a CSV already recognises and leaves out) as a target, "From your sheet".
It is stored per vendor as a read-only line, replaced by each import, and never touches the organizer's note written in the app.

## Acceptance criteria

- [x] Mapping a column fills the line; re-importing replaces it; the app note is untouched.
- [x] Unmapped, nothing is stored.
