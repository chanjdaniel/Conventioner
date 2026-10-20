---
id: E35/F03/S02
title: The download carries the full name
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

The assignment CSV keeps the name each vendor chose and adds a **Full name** column beside it.
A vendor whose application has no full name leaves the column blank.

## As built

- The download's columns are Name (the name the vendor chose, or their full name), Full name, Email, then one per date (`assignment/csv_output.py`).
- `vendor_full_names_for_market` reads the full names; both it and `vendor_names_for_market` walk the same projection (`_names_by_address`).

## Acceptance criteria

- [x] The download has both columns, in that order.
- [x] A vendor with a preferred name shows both; one without shows the full name in both.
