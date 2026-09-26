---
id: E23/F02/S01
title: The chosen dates are listed by month beside the calendar
type: story
status: done
blocked_by: []
pr: [#83]
---

## What to build

In Market Setup's Market Dates card, the calendar sits on the left (360px, down from a centred 420) and the chosen dates are listed on the right:

- A count heading: "20 market days", "1 market day".
- **One line per month**: the month and year ("October 2026"), then its days ("Sat 3", "Sat 10", …). The list grows by months, not by dates, so a 20-date market is five lines and stays within the calendar's height.
- **Each listed day has a ×** that removes it, the same as clicking it on the calendar.
- **Clicking a month moves the calendar to it**, and **the month the calendar shows is highlighted** in the list.
- With too little room beside the calendar, the list goes under it.
- With no dates, the list says so and points at the calendar.

A market date is a calendar day, not an instant: every date in the list is formatted with UTC arithmetic, as `getFormattedDate` is, and `e2e/date-display-timezone.spec.ts` extends to the list.

## Acceptance criteria

- [x] At 1920x1080, with 1, 5 and 20 dates, the calendar and the list sit side by side and the card is no taller than the calendar.
- [x] Dates spanning a new year show both years.
- [x] × removes a date; clicking a month shows that month; the shown month is highlighted.
- [x] Below the room for both, the list sits under the calendar.
- [x] The list shows the same day in Honolulu, Los Angeles and Tokyo.
- [x] The existing dates testids keep working, or the specs that use them move with them.
