---
id: E31/F03/S05
title: Nothing is shown as assigned until a run is stored
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Before an assignment is stored, Result and Vendors say "Nothing assigned yet" and link to Assignment, instead of drawing the solver's unstored preview as if it were the result ("No assignment yet" over a full grid; "197 of 197 vendors assigned" before anyone assigned anything).
`assignment_to_show()` no longer falls back to a fresh run for these pages; `GET /markets/:id/assignment` stays the explicit preview.

## Acceptance criteria

- [x] In every phase before a stored run, Result and Vendors show the empty state with its link.
- [x] After a run, both show the stored assignment, as today.
- [x] The statistics and CSV download follow the same rule.
