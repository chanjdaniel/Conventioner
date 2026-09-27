---
id: E24/F02/S02
title: The file proposes the plan
type: story
status: in-progress
blocked_by: [E24/F02/S01]
pr: []
---

## What to build

The proposal also says what the file states about the plan: the market dates, the tiers best first, and the ceiling on days per vendor.

- **Dates** come from the tier grid's bracketed headers ("Monday, November 17") or from answers that are dates ("Monday, November 20th, Tuesday, ..."), month and day only; the proposal names the year the stated weekdays fit (exactly one within two years either side in every corpus file), or none, for the year dialog to open on.
- **Tiers** are the tier grid's options other than "None", ordered by where they fall in joined answers.
- **The ceiling** is read from any header's prose ("up to / a maximum of / at most / no more than N days"), with the sentence it came from; it is an assignment rule, not a plan card.

The organizer's plan wins ([map](../../../wayfinding/the-form-started-from-a-csv/map.md), settled while charting): where the plan already has dates or tiers, the file's are matched against them as the import matches values, and a disagreement comes back as a value to settle (map to one of the plan's, or ignore), never added to the plan.

## Acceptance criteria

- [x] On the five fixtures, dates, tiers and their order, and the ceiling match [03](../../../wayfinding/the-form-started-from-a-csv/issues/03-how-good-are-the-rules-alone.md)'s answers: 5 of 5 each.
- [x] The fitting year is the one the corpus files were for, in all five; a file whose weekdays fit no year proposes none.
- [x] A market whose plan has Gold and Silver, given a file with Bronze, gets Bronze back as a disagreement, and the plan is unchanged.
- [x] A file with no grid and no date answers proposes no dates, and the review will ask no year.
