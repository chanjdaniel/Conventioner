---
id: E14/F01/S01
title: Every date prints its year once
type: story
status: in-progress
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

- [x] No market date renders its year twice, on any of the four call sites.
      All four are now asserted exactly rather than by substring: the organizer panel chip and the
      applicant checkbox label in `essential-fields.spec.ts`, and both stored-answer renderings in
      `essentialDate.test.ts` and on the applicant dashboard.
      A fifth render found on the way - the tier-day label - went through `getFormattedDate`
      directly and now goes through `formattedEssentialDate` with the rest.
- [x] A unit test pins the composition, so the next change to `getFormattedDate` cannot silently reintroduce it.
      In two halves, because neither is sufficient alone: the year-occurrence count catches a change
      to `getFormattedDate` (the composition assertion moves with it and cannot), and the composition
      assertion catches decoration added back on this side that is not a year.

## Notes

Startable now; blocked by nothing.
This is the cheapest finding in `.lavish/qc-2026-09-20.html` (F5) and one of the two most visible.

## Done, beyond the ask

`answerText` joined a list with `', '`, and a formatted date carries two commas of its own, so two
dates ran together with no readable boundary.
The doubled year was the louder half of that string, not all of it.
Both branches now use the middot the tier answer already used; it reaches the rankings too, which is
deliberate - one function, one separator, and a section name can carry a comma as easily as a date.
