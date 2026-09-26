---
id: E22
title: The assignment tab
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

A market's assignment work reads as one place.
Setting the rules and running them is one page; reading and changing the assignment they produced is another.
Every market screen, Tables, Attendance and Vendors included, is reached the same way.

## Why now

From the 2026-09-26 brain dump: "Assignment results" is one long page where the rules, the run and the whole result share a scroll, and the only place a result can be changed (Tables) is a separate screen reached by a quick link.
The market frame (E21) just settled how a market's screens are held and pinned, so this is the moment to settle how they are reached.

Charted in [the-assignment-tab](../../wayfinding/the-assignment-tab/map.md).
The map is closed: every question is resolved, and the four features below are the whole of the work.

## Features

- `F01` - plain fixes: the Assignment Options card shows both options, and the tab is called Assignment. Startable now.
- `F02` - the assignment rules close with the assignment: the server refuses a change after `assignment`, and the page reads as settled. Startable now.
- `F03` - the result knows what it was made from: a run fingerprints the rules, the plan and the approved applications, and the result says when they have changed. Startable now.
- `F04` - the Assignment tab has pages: one width for every market screen, an address for every page, the bar on all of them, and Assignment, Result and Vendors as the tab's pages.

## Order inside this epic

`F01`, `F02`, `F03/S01` and `F04/S01` are independent and startable now.
`F04` runs `S02` (after `F01/S02`, which renames the tab it moves), then `S03`, `S04`, `S05`.
`F03/S02` can land before `F04/S04` at the top of today's results, and moves onto the Result page with it.
`F02/S02` follows `F02/S01`.
