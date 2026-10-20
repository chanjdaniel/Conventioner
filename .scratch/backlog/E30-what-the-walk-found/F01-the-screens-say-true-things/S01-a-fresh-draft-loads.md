---
id: E30/F01/S01
title: A fresh draft's Result and Vendors load
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

A market just created (a name and an organization, no plan yet) shows "Nothing assigned yet" on Result and Vendors instead of a red "Internal server error".
Today `GET /markets/:id/tables` and `GET /markets/:id/assignment-statistics` answer 500 with "Market must have setup data to perform assignment" when the market has no `setupObject`.
The same Result banner reads "...the assignment phase.Set the rules" in every pre-assignment phase; it gets its missing space.

Reproduce it first, end to end, on a fresh market made through the create dialog.

## Acceptance criteria

- [x] A market with a null `setupObject` answers both endpoints without a 500, with an empty result.
- [x] Result and Vendors on that market render their empty state, with no error.
- [x] The banner reads "...the assignment phase. Set the rules".
- [x] A pytest pins both endpoints on a market with no plan; an e2e opens both pages on a fresh market.
