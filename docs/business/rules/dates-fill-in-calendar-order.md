---
layer: business
kind: rule
describes:
  - back-end/assignment/assignment.py#MarketAssignment.assign
  - back-end/assignment/assignment.py#MarketAssignment.sort_vendors
verified: 2026-10-22
sources:
  - bug/39
  - known-gap/1
  - E26
---

# Dates fill one at a time, in the plan's order

The solver fills a market's dates one after another, each date before the next, so when there are more tables than vendors want, the early dates fill and the late ones run thin.
This is kept on purpose.

On each date every approved vendor who can attend and has not reached their limit gets one turn, those with the fewest dates so far first, then by the organizer's rules.
A vendor free all week who wants two dates is given the first two they can attend, and is at their limit before the later dates come round.

**The order is the plan's, not the calendar's.**
The solver walks the dates in the order the plan stores them, and nothing sorts them first.
A plan started from a Google Form's responses stores them in calendar order; dates picked on the Market Setup calendar are stored in the order they were clicked, so a market whose last day was picked first fills that day first.

**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

## Why

No vendor is placed worse by it: how many dates each vendor gets, and so satisfaction, is the same whichever order the dates are filled in.
When demand exceeds the tables every date fills, and the order never shows.
Whether a market wants its vendors spread evenly, kept to consecutive days, or front-loaded is a choice about what a market is, and nobody has made it.

## Where it is kept

The date loop is `MarketAssignment.assign` in [`back-end/assignment/assignment.py`](../../../back-end/assignment/assignment.py), and the order of the turns on each date is `MarketAssignment.sort_vendors` in the same file ([priority and tie-breaks](priority-and-tie-breaks.md)); the module is [the assignment solver](../../implementation/modules/assignment-solver.md).
The usability gaps the same runs left are in [MVP_KNOWN_GAPS.md](../../MVP_KNOWN_GAPS.md#1-the-solver-fills-market-dates-in-calendar-order).

## Changing it

Decide the rule first.
Two candidates cost no vendor a date: give each vendor one date per round, choosing the date with the most free tables they can take; or keep the walk and, when a vendor can attend more dates than they want, choose among those by how full each date already is.
Either is written first as a case in [`back-end/tests/test_assignment_behaviour.py`](../../../back-end/tests/test_assignment_behaviour.py), [the solver's behavioural suite](../../implementation/testing/assignment-behaviour-suite.md).
Sorting the dates before the walk would make the order the calendar's whatever order they were picked in, and changes nothing else.

## Evidence

On the usage run's March 2026 market (84 vendors, 5 dates, 50 tables, at most 3 dates each), every vendor was placed and got every date they could have had, but the dates held 50, 59, 55, 27 and 19 placements from Monday to Friday.
