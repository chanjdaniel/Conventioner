---
id: E36/F02/S03
title: Not approved is marked wherever overrides show
type: story
status: ready
blocked_by: [E36/F02/S02]
pr: []
---

## What to build

A seat held by someone who is not approved carries a "not approved" mark everywhere the tier, date and table-size overrides already show: the results grid, the seat, the vendor drawer, and the assignment download (decision 4).
The override reasons served on the market read gain "not approved" as one of their own, so every surface reads it from one place.
The vendor drawer always says a vendor is rejected, including when no giver is recorded (an older verdict, or an import), which it currently leaves blank (research 6.5).

## Acceptance criteria

- [ ] A rejected applicant seated by hand shows "not approved" on the grid, the seat and the drawer, and in the download.
- [ ] An approved vendor's seat never shows it.
- [ ] The drawer shows "Rejected" for a rejection with no recorded giver.
- [ ] The mark is served by the market read alongside the other override reasons, not derived on any one screen.
