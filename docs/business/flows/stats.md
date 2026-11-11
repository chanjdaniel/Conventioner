---
layer: business
kind: flow
describes:
  - front-end/src/views/StatsView.vue
  - front-end/src/utils/applicantStats.ts
  - front-end/src/utils/answerCounts.ts
  - front-end/src/utils/marketStats.ts
  - back-end/market_stats.py
  - front-end/src/utils/statsHeadlines.ts
  - front-end/src/utils/appliedOverTime.ts
  - front-end/src/utils/roomRows.ts
  - front-end/src/utils/fillGrid.ts
  - front-end/src/utils/moneyCard.ts
  - front-end/src/utils/checkInRows.ts
  - front-end/src/components/charts/
verified: 2026-11-12
sources:
  - E45/F01/S01
  - E45/F01/S02
  - E41/F01/S01
  - E45/F01/S03
  - T263
  - T201
---

# The market's statistics

**Who:** anyone who can read the market, a Viewer included; the page changes nothing ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Stats tab, last on the market bar, at `/markets/<id>/stats`, open in every phase from draft to the archive.

The Stats page ([`StatsView.vue`](../../../front-end/src/views/StatsView.vue)) reads the market's figures as charts drawn in the app's own HTML and CSS ([`components/charts/`](../../../front-end/src/components/charts/)), each with its figures as text, rather than a chart library: applications over time as columns, the review as one split bar, the room as a meter bar a day and a tier, how full as a table of sections against days, the money and each day's check-in as meter bars, and the answers as cards of bars, each row an answer with its count, its share of the whole and a bar against the largest in its card.
Before anyone applies it says "Nobody has applied yet." and shows the room alone, so a draft already shows its capacity.
Every figure is counted on the server and read in one small answer (`GET /markets/<id>/stats`, [`back-end/market_stats.py`](../../../back-end/market_stats.py), read by [`marketStats.ts`](../../../front-end/src/utils/marketStats.ts)), so the page never downloads the applications to count them, however many applied.
A jump through history from one market's Stats to another's keeps the page, so the first market's figures go at once: none of them is drawn under the next market's name while it counts, or if its read fails (`the-stats-tab.spec.ts`).
Its sections keep one order, the market's life's: who applied, the room, how full, the money, check-in, then what they answered (T201).
Their cards stand two to a row while the page's content is 48rem wide or more, one below it, so a lone card stays half the page at a desk and no bar runs the frame's width; the chart over time and the review's split bar, each one line of a whole, span the row, the chart's columns spread across it; the How full card spans it up to its table's width, ending where its table does.
The page fits a phone, so how the day stands is read at the market (T180): its strip's tiles stand two to a row, each link a thumb's target, and the switch and the cards stay inside the window ([the design language](../../design-system.md#layout)).

## N1. See the market's state at a glance

**Status:** Works (read from the code as of T201 ticket 06: `the-stats-headlines.spec.ts`, `statsHeadlines.test.ts`).

1. The page's top line is a strip of tiles chosen by the market's phase ([`statsHeadlines.ts`](../../../front-end/src/utils/statsHeadlines.ts)), each a figure drawn large over the words that say what it counts, the whole tile one link to where the figure is worked on, opening that page with its filter:
   - Draft: none, so no strip.
   - Applications (Review on a Google Form market): "36 applied", every application, opening the Applications tab's All view; "12 open to review", its Open filter on every reviewer's share, as the review's split bar counts it; and "84 of 60 table-days asked", every market day's tables asked and its tables summed, bringing the Room section below into view and reading on from its heading.
   - Assignment: "84 of 120 table-days used", the Assignments page's strip, opening Assignments; "3 unassigned", the Assignments strip's "N unassigned", opening [Vendors](vendors.md) on "Unassigned only" (`?show=unassigned`); and "$1,450.00 still owed", the [Payments](payments.md) page's Still owed, opening Payments on "Owes" (`?show=owes`).
   - Market Days: "18 of 24 checked in, Nov 14, 2026" and "6 not yet in", the door's count of the day ([N6](#n6-see-who-has-come)), each opening Attendance on that day (`?date=`); and what is still owed.
   - Archived: "31 vendors came", each vendor checked in on any day counted once, opening Attendance; the table-days used; and "$1,450.00 paid", the Payments page's Paid, opening Payments.
2. In Market Days the day counted is today when today is a market date, else the next market date ahead, else the last, in the reader's calendar, and the tile names it in a market date's short form; once that day is over, its missing "did not come", in the door's words.
3. Each figure is counted on the server by the page it links to, and a tile whose figure is absent is left out: the placements before an assignment is stored, from the one count of the stored assignment the Assignments page's strip reads ([placements](../../implementation/modules/placements.md#what-a-read-shows)); the money where the market sets no prices or the Payments page has nobody to count; who came in an archived market that never reached Market Days; the room in a plan of no date.
   With no tile to tell, there is no strip.
4. A zero whose link would list nothing, "0 applied", "0 open to review", "0 unassigned", "$0.00 still owed" or "0 not yet in", is told but not linked, as the Assignments page's counts cannot be chosen at zero; so is the day's check-in on a day nobody is assigned to.
5. At a desk the tiles stand in one row, each an equal share of it; on a phone two to a row, an amount and a tile it would leave alone on its row each taking a row of their own ([the design language](../../design-system.md#layout)).

Covered by:

- `statsHeadlines.test.ts` (every phase, the day counted, an archive that never ran, a zero not linked)
- `test_the_stats_headlines.py`
- `the-market-on-a-phone.spec.ts` ("Stats", on a phone and at a desk, on a market at the door with every section drawn: the strip two to a row and in one row, every section inside the window, a tile's link landing on Payments at the window's width, and a Viewer's page; "Stats keeps its strip and every section inside the frame at 320")
- `the-stats-headlines.spec.ts` ("the strip has no tile in draft, and in applications tells who applied, who is open and the table-days asked", "from assignment to the archive, each tile is the figure of the page it links to, opened on its filter", "a zero whose link would list nothing is told, not linked, and an archive that never ran tells no one came")

## N2. See who applied

**Status:** Works (read from the code as of T201 ticket 02: `the-stats-tab.spec.ts`, `test_the_stats_tab.py`).

1. "Who applied" totals the market's [applications](../concepts/application.md): "7 applications in all, 1 of them added by hand".
2. "When they applied" draws a column a day, from the day applications opened, or the first response if that came earlier, as a Google Form's can, to today while the market takes applications or to the day they closed, so a quiet day is a gap on the baseline and a late rush stands out ([`appliedOverTime.ts`](../../../front-end/src/utils/appliedOverTime.ts)).
   Once that span passes 42 days a column is a week, Monday to Sunday, so the columns stay readable on a phone.
   A line at the top marks the largest count, and the first and last column are named under the axis.
   The chart is one image named by a sentence, "6 applications from Aug 31 to Sep 5, 2026, most on Sep 3: 3", and "Numbers by day" (or by week) opens a table of every day, the empty ones included.
   A vendor added by hand never applied, so is on no day; with nobody applied with a time there is no chart.
3. The days are the reader's own calendar: the server keeps no time zone for a market, so it sends only the time each applied, never who, and the page makes the days.
   When applications opened and closed come from the market's [phase record](../../implementation/modules/phase-record.md): the first entry into applications, and the first entry into assignment after it, so a market reopened or sent back to review keeps its first opening; while a market sent back takes applications again, the chart runs to today, so the quiet days since show.
   A market out of applications whose record holds no close, one that predates the record, ends at its last response; a response after the close is still drawn.
4. "Where the review stands" is one bar of every application split by status, in the Applications tab's All view's order: Open, Needs follow-up, Approved and Rejected, each its own fill, set apart by a white gap.
   Its legend is the text, a line per status with its count and share, each count what that filter lists; a line opens the All view on its filter, on every reviewer's share ("Assigned to: Anyone"), since the count is everyone's, and a status nobody is in is told but not linked.
   The server counts every application by its stored status, and the page counts those into the filters through the All view's own test ([`applicantStats.ts`](../../../front-end/src/utils/applicantStats.ts)), so the two pages agree; a status no filter lists is a grey part of its own, linked nowhere.

Covered by:

- `test_the_stats_tab.py` (when applications opened and closed, a reopened market's first window included)
- `the-component-library-charts.spec.ts` (the column chart a day and a week, its numbers, the split bar and its legend, a zero not linked)
- `the-stats-tab.spec.ts` ("the Stats tab counts who applied as the Applications tab does, for anyone who reads it", "a review status with nobody in it is told, and not linked")

## N3. See whether there is room for those asking

**Status:** Works (read from the code as of T201 ticket 03: `the-stats-tab.spec.ts`, `test_the_stats_room.py`).

1. "Room" shows in every phase, from draft on, wherever the plan has a date.
   "Tables asked each day" is a row per market date: the date, "42 asking, 30 tables", and a bar of the tables asked with a black line where the day's tables end, what is asked past it drawn in the attention fill ([the design language](../../design-system.md#the-contrast-contract)).
   A day's tables are the plan's, every section's on every date.
2. With two tiers or more, "Table-days asked each tier" is a row per tier the same way, "84 asking, 60 table-days", over every date: the tier's own sections' tables times the dates.
   A plan of one tier has no tier card, which would repeat the days.
3. Asked is a ceiling, and each card says so under its rows: someone available three days who wants at most two counts on all three, and a vendor who accepts two tiers on a day counts in both, so the tier rows can add up to more than the days.
   It counts every application the review has not rejected, a vendor added by hand among them, and not a waitlist one, on each date it is available: a half table as 0.5, a full table, "either" or no answer as 1.
4. The answers are read as [the solver](../../implementation/modules/assignment-solver.md) reads them, an organizer's [update of an answer](../rules/an-update-is-kept-beside-the-vendors-answer.md) in its place, so a date or tier the plan no longer offers counts nowhere, and a vendor never asked their tiers counts in every tier ([tier filters, section prefers](../rules/tier-filters-section-prefers.md)).
5. Before anyone applies each row reads its tables alone, "30 tables", with no bar and no note.
6. Every row of a card is drawn on one scale, the card's largest asked or tables, so the rows compare; the bar is hidden from a screen reader, which reads the row's words.

The server counts it (`count_room` in [`back-end/market_stats.py`](../../../back-end/market_stats.py), the answer's `room`, `null` where the plan has no date), and [`roomRows.ts`](../../../front-end/src/utils/roomRows.ts) makes the cards.
Covered by:

- `test_the_stats_room.py`
- `the-component-library-charts.spec.ts` (the fixture's room, one scale a card, the mark and the attention fill, the tables alone)
- `the-stats-tab.spec.ts` ("the room reads each day and tier as the tables asked against the plan, past them in the attention fill", "a market nobody has applied to says so, in draft")

## N4. See how full the market is

**Status:** Works (read from the code as of T201 ticket 04: `the-stats-tab.spec.ts`, `test_the_stats_fill.py`).

1. "How full" shows once an assignment is stored, in any phase, as the strip's table-days used does: a table with a row per section, its tier under its name, a column per market date and a row "All sections" totalling each day.
2. Each cell reads "28/30", the section's tables used that day of its tables, a table with anyone at it used, half held included, so the cells add up to the strip's table-days used, and their tables left to the Assignments grid's "Empty" count.
   The server counts it from the same stored rows as the strip's table-days used, the Assignments page's tables grid's ([placements](../../implementation/modules/placements.md#what-a-read-shows)), and sections and dates stand in the plan's order.
3. A cell is shaded by how full it is, in five steps: empty, the card's white with its edge drawn; up to a third; up to two thirds; past that but short of full; and full, each a step darker green ([the design language](../../design-system.md#the-contrast-contract)).
   The shade is never the only carrier: the figures are hidden from a screen reader, which hears each cell as "28 of 30 used, more than two thirds full".
4. A table wider than its card, more days than a phone holds, scrolls sideways in its own box with the section names held at the left, the one sideways scroll on the page; the page itself stays inside the window.

The server counts it (`count_fill` in [`back-end/market_stats.py`](../../../back-end/market_stats.py), the answer's `fill`, `null` until an assignment is stored), and [`fillGrid.ts`](../../../front-end/src/utils/fillGrid.ts) makes the rows, the total and each cell's step.
Covered by:

- `test_the_stats_fill.py`
- `the-component-library-charts.spec.ts` (the fixture's seats every table taken, a cell at each step and its shade, nine days scrolling in their box on a phone)
- `the-stats-tab.spec.ts` ("how full reads each section on each day as its tables used, totalled, and scrolls in its own box on a phone")

## N5. See where the money stands

**Status:** Works (read from the code as of T201 ticket 05: `the-stats-headlines.spec.ts`, `test_the_stats_headlines.py`).

1. "Money" shows where the market sets prices and the [Payments](payments.md) page has someone to count, in any phase.
2. "Owed and paid" tells "Owed", "Paid" and "Still owed", each to the cent ([an amount reads to the cent](../rules/an-amount-reads-to-the-cent.md)), the Payments page's own figures, counted on the server by that page's code (`count_money`, by `market_money`: [payments, and what a vendor owes](../../implementation/data/payments.md)).
   "Still owed" opens Payments on "Owes" (`?show=owes`); at "$0.00" it is told but not linked, as nobody owes.
3. Under them one meter bar, "Collected", reads "$900.00 of $1,450.00 paid": paid drawn against what is owed, the track's end; only a payment beyond what is owed marks it with a black line inside the track and is drawn past it in the attention fill; a refund beyond what was paid leaves the bar empty, its words still saying it.
   The bar is hidden from a screen reader, which reads the words.
4. On a card wide enough for a large amount in each, the three stand side by side, each its label over its amount; on a narrower one, a phone's, one to a line, the label at its start and the amount at its end.

[`moneyCard.ts`](../../../front-end/src/utils/moneyCard.ts) makes the card from the answer's `headlines.money`.
Covered by:

- `test_the_stats_headlines.py` (the money is the Payments page's figures, and absent without prices)
- `the-stats-headlines.spec.ts` ("the money reads the Payments page's figures, a bar of paid against owed, and still owed opens Owes", "check-in reads each day's vendors in of those expected from Market Days, and who is not yet in opens that day": no money on an unpriced market)

## N6. See who has come

**Status:** Works (read from the code as of T201 ticket 05: `the-stats-headlines.spec.ts`, `test_the_stats_check_in.py`).

1. "Check-in" shows from Market Days on, in Market Days and in the archive of a market that ran ([the phase record](../../implementation/modules/phase-record.md)'s `ran`); an archived market that never reached its days has none.
2. "Checked in each day" is a row per market date: the date, "18 of 24 checked in", and a bar of those checked in, every day on the scale of the day with the most expected; a day expected short of it has a black line at its own expected, where its whole ends inside the track.
   Expected and checked in are the door's own count of the day, [Attendance](../../implementation/modules/attendance-and-door.md)'s "18/24": a row each for every seat the stored assignment holds that day, here when its vendor has checked in, by an organizer at the door or by the vendor on their vendor page.
3. Beside the figures, how many are missing: "6 not yet" while the day may still come, "6 did not come" once it is over, past or the market archived, as the door words a row; either opens Attendance on that day (`?date=`).
   A day with nobody missing says "Everyone is in" and links nowhere; a day nobody is assigned to says "Nobody is assigned" with no bar.
4. Every row is drawn on one scale, the card's largest expected, so the days compare; the bar is hidden from a screen reader, which hears the row as "Friday, May 8, 2099: 1 of 2 checked in, 1 not yet".

The server counts it (`count_check_in` in [`back-end/market_stats.py`](../../../back-end/market_stats.py), the answer's `checkIn`, `null` until the market has reached Market Days) by `check_in_counts` beside the Attendance roster, which also counts `came`, the vendors checked in on any date, each once; [`checkInRows.ts`](../../../front-end/src/utils/checkInRows.ts) makes the rows and their links.
Covered by:

- `test_the_stats_check_in.py`
- `the-stats-headlines.spec.ts` ("check-in reads each day's vendors in of those expected from Market Days, and who is not yet in opens that day")

## N7. See what they answered

**Status:** Works (read from the code as of T201 ticket 01: `the-stats-tab.spec.ts`, `test_the_stats_tab.py`).

1. "What they answered" shows a card per question of the form that offers choices (select, multi-select or checkbox), titled by the question, in the form's order; a free-text question, and the essential questions about dates, tiers and tables, are not charted.
2. Each option the question offers is a row, one nobody chose included, at zero; a multi-select counts every option ticked, so its shares add up to more than 100%; a checkbox reads "Yes" and "No".
   A card lists its rows most chosen first, a tie in the form's order, and shows the first 8; "N more answers" unfolds the rest in place and becomes "Show fewer" ([the design language](../../design-system.md#the-primitive-layer)), so a question of 230 options does not bury the page.
   In a card wider than 32rem, as each is in a window 1280px wide or more, a row is one line: the answer, its bar, then its count and share; in a narrower one the bar stands under the answer and its figures.
3. Every answer the question does not offer, written in under "Other" on a Google Form or an option since taken off, is one row, "Other", counting each applicant once however many they wrote; those who gave no answer are a row, "No answer". Either is left out when nobody is in it.
4. A switch, "All", "Approved" and "Assigned", narrows every card at once, with "N of M" beside it; the choice is kept in the address (`?among=approved`, `?among=assigned`), so a reload or a shared link opens on it.
   Approved is the All view's Approved, those added by hand among them; Assigned is everyone with an assignment, a table on any date, whatever their verdict, as the outcome they are told is read.
   A share is of the group chosen.
5. A group nobody is in says so instead of charting noughts: "Nobody is approved yet.", "Nobody is assigned yet."
   A form with no question to chart says "The form asks no question with choices to count."

A row leads nowhere: the All view filters by status, not by an answer.
The counts come in the page's one answer, read by [`answerCounts.ts`](../../../front-end/src/utils/answerCounts.ts); they read the answers as the organizer does, an organizer's [update of an answer](../rules/an-update-is-kept-beside-the-vendors-answer.md) counted in its place.
Covered by:

- `test_the_stats_tab.py`
- `the-component-library-charts.spec.ts` (the one-line rows at a desk, stacked on a phone and in a narrow card, the fold of 8)
- `the-stats-tab.spec.ts` ("a chart per choice question counts each option, groups "Other", and narrows to the approved and the assigned", "a question of more than eight answers folds past eight, most chosen first, each one line at a desk")

## The rules it obeys

- [What each role may do](../rules/what-each-role-may-do.md): reading the market is all the page asks.

Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
