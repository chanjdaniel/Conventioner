# 02: How do the market dates sit beside their calendar?

Type: prototype
Status: resolved
Blocked by: 01

## Question

The brain dump asks for the calendar on the left and the chosen dates listed on the right, "flowing top to bottom", in place of today's calendar centred over a row of chips.
What does that look like for a market of 1 date, 5 dates and 20 dates, inside whatever width [01](01-the-row-rule.md) gives the card?

- **How the list flows.** One column that grows past the calendar's height, or columns that fill top to bottom and then wrap into the next column?
  At 20 dates, which reads better, and which keeps the card no taller than the calendar?
- **What a listed date says and does.** Today's chips carry the full date ("Saturday, August 1, 2026"); a date is removed by clicking it on the calendar.
  Does the list add a remove control, grouping by month, or a count?
- **Dates in more than one month.** The calendar shows one month at a time; does the list make the others visible, and does clicking a listed date move the calendar to it?
- **Does the dates card share its row?** It is the tallest card on the plan; 01's rule decides whether anything sits beside it.

Show it on the real route, with markets seeded at each date count.

## Answer

Prototyped and decided 2026-09-26.
The prototype is primary source on the local branch `prototype/plan-row-rule` (commit `b58c5ee6`): three lists beside the calendar inside [01](01-the-row-rule.md)'s rule, switched by `?variant=A&dates=A|B|C`, on seeded markets of 1, 5 and 20 dates.

| | List | What it showed |
| --- | --- | --- |
| A | One column of full dates | At 20 dates it runs about 300px below the calendar, with the right half of the card empty. |
| B | Short dates in columns to the calendar's height, then wrapping | Compact, but "Sat, Jan 2" loses its year where the market crosses one. |
| C | One line per month, its days as chips | Uses the card's width, stays within the calendar's height at 20 dates, and keeps every year in view. |

**C, grouped by month**, beside the calendar:

- **The calendar on the left at 360px** (it was 420, centred); **the list on the right**, headed by a count ("20 market days").
- **One line per month** ("October 2026", then "Sat 3 · Sat 10 · Sat 17 · Sat 24"): it grows by months, not by dates, so a 20-date market is five lines.
- **A listed day has a ×** that removes it; **clicking a month moves the calendar to it**; **the month on show is highlighted** in the list.
- **The card stays wide** under 01's rule, and the list takes the width beside the calendar; with too little room the list goes under the calendar.
- Dates stay calendar days: the list's formatting is UTC arithmetic, as `getFormattedDate` is, and the timezone spec covers it.

Buildable work: [E23/F02 The market dates sit beside their calendar](../../../backlog/E23-the-plan-uses-its-space/F02-the-dates-sit-beside-their-calendar/feature.md).
