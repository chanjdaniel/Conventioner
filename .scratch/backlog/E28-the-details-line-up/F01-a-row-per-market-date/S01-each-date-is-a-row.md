---
id: E28/F01/S01
title: Each chosen date is a row, under its month, flowing in columns
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

In Market Setup's Market Dates card, the list beside the calendar changes from one line per month of day chips to one row per date:

- The count heading stays: "20 market days", "1 market day".
- **A month heading** ("October 2026") **then one row per date in it** ("Sat 3", with a × at the row's end that removes it, the same as clicking it on the calendar).
- **The rows flow top to bottom in columns no taller than the calendar**, then continue in the next column.
  A month heading never sits alone at the foot of a column; it moves with its first row.
- **Clicking a month heading moves the calendar to it**, and **the month the calendar shows is highlighted**, as now.
- With too little room beside the calendar, the list goes under it, as now.
- With no dates, the list says so and points at the calendar, as now.

Market dates stay calendar days: every row is formatted with UTC arithmetic, as `getFormattedDate` is.

## Acceptance criteria

- [ ] At 1920x1080, with 1, 5 and 20 dates, each date is its own row and the card is no taller than the calendar.
- [ ] Rows read top to bottom, then the next column; no month heading is left at the foot of a column without a row under it.
- [ ] Dates spanning a new year show both years in their month headings.
- [ ] × removes a date; clicking a month shows that month; the shown month is highlighted.
- [ ] Below the room for both, the list sits under the calendar.
- [ ] The list shows the same day in Honolulu, Los Angeles and Tokyo (`date-display-timezone.spec.ts`).
- [ ] The existing dates testids keep working, or the specs that use them move with them.
