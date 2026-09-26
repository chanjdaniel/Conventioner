---
id: E22/F04
title: The Assignment tab has pages
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

Every market screen is reached the same way: the market's bar carries Market Setup, Application Form, Applications, Assignment, and Attendance once the market is published.
The Assignment tab has three pages - **Assignment** (the rules and the run), **Result** (the assignment by table, read and changed) and **Vendors** (the assignment by vendor) - and every page has its own address.

## Why now

Decided in [the-assignment-tab 01](../../../wayfinding/the-assignment-tab/issues/01-what-is-on-each-page.md) and [02](../../../wayfinding/the-assignment-tab/issues/02-how-every-market-screen-is-reached.md), from a prototype of three navigations on the real screens.
Today the result is one long page under the rules, the only place it can be changed (Tables) is a separate screen reached by a quick link, and Tables, Vendors and Attendance carry the rail but not the tabs.

## Stories

- `S01` - every market screen is one width.
- `S02` - every market page has its own address, and the bar reaches every one.
- `S03` - the Assignment tab's pages.
- `S04` - the Result page is the assignment, read and changed.
- `S05` - the statistics open under the result.

## Order

`S01` is independent. `S02`, then `S03`, then `S04`, then `S05`.
