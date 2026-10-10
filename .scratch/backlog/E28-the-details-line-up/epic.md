---
id: E28
title: The details line up
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

The screens an organizer spends longest on hold up at the pixel level and filter the way they read.
The market dates list one row per date, the vendors page filters as the tables page does, the table counts are filters, the priority rules table is drawn from the design system's primitives, and the marks and hints that were a few pixels off sit where they belong.

## Why now

Seven UI adjustments from the [2026-10-09 brain dump](../../brain-dump/2026-10-09.md), plus what a screenshot pass of those same screens found clearly off.
Settled in one grilling session on 2026-10-10 rather than a Wayfinder map: four of the seven were plain fixes, and the three real decisions (how the dates rows flow, what the vendor filters filter by, how a count filters) were answered in that session and are recorded in the stories below.

**One decision here reverses an earlier one.**
[the-plan-uses-its-space 02](../../wayfinding/the-plan-uses-its-space/issues/02-market-dates-beside-their-calendar.md) chose one line per month with the days as chips, over one row per date, because a single column of 20 dates ran far below the calendar.
`F01` keeps one row per date and answers that objection by flowing the rows into columns no taller than the calendar.

## Features

- `F01` - the market dates list one row per date. Startable now.
- `F02` - the results filter alike: the counts filter the tables, and the vendors page gets the tables page's filters. Startable now.
- `F03` - the priority rules table is cleaned up. Startable now.
- `F04` - small things line up: the seat hint, the centred marks, and the screenshot pass's other finds. Startable now.

## Order inside this epic

Every feature is independent.
Inside `F02`, `S01` first is easier to review, since it adds the fifth filter before the bar is shared.

## Out of scope

- The floating pill on the Section Setup header: it is the Vue DevTools overlay, development only.
- The green "Full Table" chip beside the grey "Half Table" chip on the tables grid: deliberate.
