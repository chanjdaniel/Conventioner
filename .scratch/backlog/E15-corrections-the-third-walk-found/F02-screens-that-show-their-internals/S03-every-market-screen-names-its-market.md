---
id: E15/F02/S03
title: Every market screen names its market
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Three sibling screens use three title conventions:

| Screen | Header reads | Names the market? |
| --- | --- | --- |
| Vendors | `Vendors: Spring Craft Fair 2027` | yes |
| Tables | `Tables` | **no** |
| Attendance | `Attendance Status` | **no** |
| Market Setup and its tabs | `Winter Artisan Market 2026` | yes, but drops the screen name |

An organizer running two markets in the same week can open Tables and have nothing on screen tell them whose tables these are - on the screen where a hand placement moves a real vendor to a real seat.

Adopt the Vendors form everywhere: **screen name, then market name.** All four screens already have the market in hand (`useRailMarket` for Tables and Attendance).

## Acceptance criteria

- [x] Tables, Attendance, Vendors and the Market Setup tabs each name both the screen and the market.
- [x] An e2e assertion reads the market name from the header of each of the four screens.

## Notes

Startable now.
Evidence: `.lavish/aesthetics-2026-09-20.html`, O6.
