---
id: E26/F02/S01
title: Ticked checkboxes and table choices import
type: story
status: proposed
blocked_by: []
pr: []
---


## What to build

A Google Form checkbox exported as its label text reads as ticked, and the proposal matches "Full table", "Half table" and "Either" to the three table choices instead of saving them as ignored.

Closes bugs 2, 3 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [ ] Starting from the anonymised fall 2025 export and importing it imports the rows whose answers are complete, through Preview and Confirm.
- [ ] The stored mapping resolves Full table and Half table to the whole-table and half-table choices.
- [ ] Pytest pins the checkbox coercion and the table-choice resolution.
