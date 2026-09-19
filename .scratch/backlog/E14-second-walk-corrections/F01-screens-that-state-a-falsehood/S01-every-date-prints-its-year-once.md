---
id: E14/F01/S01
title: Every date prints its year once
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

`formattedEssentialDate()` (`front-end/src/utils/essentialFields.ts:125`) appends the year to `getFormattedDate(date)`.
Its own docstring explains why it had to: the old `getFormattedDate` carried no year.

`E09/F04/S02` - *the "one date format" story* - rewrote `getFormattedDate` to include the year and did not update this caller, so every applicant-facing date now reads **"Saturday, November 21, 2026, 2026"**.

Delete the year-appending branch.

Four call sites are affected, and the one that matters most is the third:

- the applicant's available-dates checkboxes (`EssentialApplicationFields.vue:208`)
- the organizer's essential-fields panel (`EssentialFieldsPanel.vue:83`)
- the stored-answer rendering (`essentialFields.ts:147,178`), which is what the **review queue** and the vendor detail panel read back - so an applicant's available dates currently read "Saturday, November 21, 2026, 2026, Sunday, November 22, 2026, 2026" on the card where the organizer decides their fate

## Acceptance criteria

- [ ] No market date renders its year twice, on any of the four call sites.
- [ ] A unit test pins the composition, so the next change to `getFormattedDate` cannot silently reintroduce it.

## Notes

Startable now; blocked by nothing.
This is the cheapest finding in `.lavish/qc-2026-09-20.html` (F5) and one of the two most visible.
