---
layer: implementation
kind: record
sources:
  - wayfinding/november-2026-dry-run/07
  - wayfinding/november-2026-dry-run/04
---
# Final dry run of the November 2026 market, 2026-10-18

The UBC Makers Market of 18 to 20 November 2026, walked end to end in a real browser on the day it goes to production, with the organizer's real Google Form export and, for the first time, the market's real room.
It follows the [2026-10-09 rehearsal](MVP_TEST_RUN_2026-10-09.md), whose plan was a stand-in.
Run on `dev` plus [#96](https://github.com/chanjdaniel/Conventioner/pull/96), the exact code promoted to production the same day.

## Summary

**The dry run passes, and found no defect.**
Every pass criterion of the rehearsal map holds on the real room, which has 42% fewer tables than the rehearsal's.

| | Result |
| --- | --- |
| Import | 212 of 212 rows; re-import: 0 new, 0 updated, 212 unchanged |
| Review | 211 approved, 1 rejected (the row the organizer's sheet marks withdrawn), by keyboard in 3 seconds |
| Assignment | 206 of 211 vendors placed, 244 placements, 177 of 177 table-days, 61% satisfaction, in about 4 seconds |
| Pairs | 36 table-share requests stand; together on 48 of the 50 dates both are placed, and the other date cannot be shared |
| Publish and check-in | Published; a vendor looked up and checked in on a phone; Attendance shows the check-in |

## The real room

Stated by the organizer on 2026-10-18; it replaces the four-section stand-in of ticket 04.

| Section | Location | Tier | Tables |
| --- | --- | --- | --- |
| A | Upper Atrium | Gold | 31 |
| B | Lower Atrium | Silver | 28 |

59 tables a day on all three days, against 101 in the rehearsal.
Half tables at the default 30% per section, and no market ceiling on days per vendor.

### What a smaller room does

Demand is about twice the room: the 211 candidates ask for about 453 vendor-days, bounded by their own maximum, against 177 table-days and the halves that share them.
Gold-only demand alone is 51 to 58 vendors a day, against Gold's 31 tables.

| Days placed | Vendors |
| --- | --- |
| 0 | 5 |
| 1 | 168 |
| 2 | 38 |
| 3 | 0 |

The solver gives each turn to whoever has the fewest days so far, so a scarce room spreads one day across nearly everyone rather than giving a few vendors three.
Whether the market wants that, or fewer vendors on more days, is the organizer's call; a ceiling on days per vendor is the plan's lever for it.

## How it was run

- **Stack:** the primary Docker stack on `dev` plus #96, with `DISABLE_EMAIL=true` and no TypeSafe key; nothing left the machine.
- **Browser:** Chromium through the Playwright MCP, 1440 by 900 for the organizer and 390 by 844 with touch for the vendor, in a fresh context.
- **Account:** `e2e@example.com` in "Seed Test Org".
- **Method:** every step through the product's own controls, the 212 verdicts by the A and R keys.
  The pass criteria were checked against the stored assignment and the stored applications, read from the local database.
- **Data:** `.scratch/examples/markets/UBC Makers Market Application - November 2026 (Responses) - Form Responses 1.csv`, git-ignored.
  It holds real applicants' details, so nothing from it is quoted here, and screenshots stay in the git-ignored `.playwright-mcp/`.

## The path: P2, started from the Google Form

Market "UBC Makers Market November 2026 Final Dry Run".

| Step | Result |
| --- | --- |
| Proposal | Three dates, the year 2026 (confirmed), Gold and Silver, 6 essential questions and 21 of the organizer's own, the status column and the repeated email column left out. "Keep all" on the three questions with rare answers, as in the rehearsal |
| Plan | The real room above, saved as typed |
| Import | 212 of 212, the proposal's mapping restored for every column |
| Re-import of the same file | 0 new, 0 updated, 212 unchanged |
| Review | 211 approved and the withdrawn row rejected; the 46 rows the sheet leaves undecided are approved as stand-ins, as in the rehearsal |
| Rules | Current students before alumni and staff; any listed club before none; no first-come rule |
| Assign | As in the summary |
| Publish | The confirmation says what goes on the air and that it cannot be undone |
| Check in | A vendor placed on two days looked themselves up on a phone and checked in for one |
| Attendance | Lists the check-in |

## The pass criteria

| Criterion | Result |
| --- | --- |
| All rows import, and re-importing changes nothing | Holds |
| Nobody on a day they answered None, at a tier they declined that day, beyond their own limit, or on a table size they did not choose | Holds: none, and no table holds more than two |
| Every approved vendor placed or told why | Holds: each of the 5 unplaced says "Every table they accept is taken" on each date they asked for |
| Pairs sit together | Holds wherever a shared table exists: 48 of 50 dates. On the other, one partner asked only Silver and the other only Gold that day, and tier is a hard filter |
| The order is respected | Holds: all 5 unplaced are alumni or staff in no club who want only Gold, and nobody ranked below them holds a seat they would accept |

## Findings

No defect.
The organizer asked for four changes after reading the run; they are built in the branch that follows this report.

1. **Check-in invites a vendor to check in on another day.**
   On a day that is not one of theirs, the page says "Today is not one of your days at this market. You can still check in for a day below."
   Check-in exists to show the vendor is present on the day, so the page must not suggest otherwise.
   It is not refused in code for now.
2. **The re-import preview's headline says "212 of 212 rows will be imported"** beside "0 new, 0 updated, 212 unchanged".
3. **The Vendors list counts a vendor's days against the market's**: "1 / 3 dates" for a vendor who asked for one day and got it.
4. **Result calls table-days "tables"**: "177 of 177 tables used" for 59 tables over three days ([known gap 7](../MVP_KNOWN_GAPS.md#7-result-counts-table-days-as-tables)).

### For the organizer before the real run

- **Do not publish until the vendors have been told.** The assignment can be finished, checked and downloaded as CSV without publishing, and publishing cannot be undone.
- **A vendor on two days usually has a different table each day**, so the emails need a table per date.
- **One table-share pair sits apart on Thursday**, because one asked only Silver and the other only Gold that day; nothing in the product says so.
- **How places are spread** (the table above) is worth deciding before assigning, not after.

### Standing

- **Attendance cannot say who is missing** ([known gap 3](../MVP_KNOWN_GAPS.md#3-attendance-cannot-say-who-is-missing)), and an organizer cannot check a vendor in.
  Decided with the organizer on 2026-10-18: both are built before the market.

## Left on the stack

| Market | Id | State |
| --- | --- | --- |
| UBC Makers Market November 2026 Final Dry Run | `912bcb54-5206-43e4-943a-1528107a25f6` | Market Days, published, 1 check-in |
| UBC Makers Market November 2026 Rehearsal 2 | `77f4e0ed-3679-45e6-bb7a-89e795d84d12` | Assignment, re-planned to the real room and assigned again (same result) |
