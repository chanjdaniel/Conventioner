---
id: E36/F02/S03
title: Not approved is marked wherever overrides show
type: story
status: done
blocked_by: [E36/F02/S02]
pr: [#116]
---

## What to build

A seat held by someone who is not approved carries a "not approved" mark everywhere the tier, date and table-size overrides already show: the results grid, the seat, the vendor drawer, and the assignment download (decision 4).
The override reasons served on the market read gain "not approved" as one of their own, so every surface reads it from one place.
The vendor drawer always says a vendor is rejected, including when no giver is recorded (an older verdict, or an import), which it currently leaves blank (research 6.5).

## As built

- `PlacementOverride.NOT_APPROVED` on the statistics read marks the drawer; the download gains an Approval column; the seat draws a chip from the tables read's own `notApproved`, which is served, not derived.
- `verdictLine` gives the drawer a verdict whose giver was never recorded.

## Acceptance criteria

- [x] A rejected applicant seated by hand shows "not approved" on the grid, the seat and the drawer, and in the download.
- [x] An approved vendor's seat never shows it.
- [x] The drawer shows "Rejected" for a rejection with no recorded giver.
- [x] The mark is served by the market read alongside the other override reasons, not derived on any one screen.
