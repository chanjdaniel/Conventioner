---
id: E31/F01/S01
title: Leaving draft requires a complete setup
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

A new precondition on `draft -> applications_open`, in `guards.py` beside the others: the market has at least one date, none of them already passed; a location; and every tier has at least one section with tables.
Its refusal names what is missing and links to Market Setup.
Each failing part is one blocker line, never a list of applicants.

This catches the CSV start's tiers without tables in draft, where the walk first heard of it in review as a 90-address blocker (screenshot `csv-review-forward`).

## Acceptance criteria

- [x] Each missing part refuses the move with its own line; all present, the move succeeds.
- [x] A market dated in the past is refused, with the dates named.
- [x] The CSV start's market (tiers, no sections) is refused in draft.
- [x] E2E seeds that open applications set up a complete plan first.
