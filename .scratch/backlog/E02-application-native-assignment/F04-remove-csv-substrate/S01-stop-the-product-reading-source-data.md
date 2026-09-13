---
id: E02/F04/S01
title: Stop the product reading source data
type: story
status: done
blocked_by: [E02/F02/S02, E02/F03/S01]
pr: []
---

## What to build

Nothing an organizer sees describes a vendor by spreadsheet position any more.

The market setup no longer has a column-selection step, and the vendor views read applications rather than column names.
The end-to-end seeds stop fabricating a CSV to reach assignment, which is also the clearest proof that the native path built in F01 actually works.

This is the first batch of the contract sequence: consumers come off first, while the fields and endpoints they were reading are still present, so nothing breaks and CI stays green.

## Acceptance criteria

- [ ] The column-selection step is gone from market setup, and setup remains navigable end to end without it
- [ ] The vendor list and vendor detail views render from applications, with no column-name reads remaining
- [ ] No front-end code calls a source-data endpoint
- [ ] The e2e seeds reach assignment without fabricating source data
- [ ] Front-end tests referencing columns are updated or removed, not skipped
- [ ] The full suite is green with the back-end fields and endpoints still in place

## Notes

Do this before the model or the endpoints come out.
Deleting the fields first would break these screens mid-sequence, which is exactly the state this ordering exists to avoid.
