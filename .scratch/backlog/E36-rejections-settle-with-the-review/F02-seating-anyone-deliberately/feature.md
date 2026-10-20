---
id: E36/F02
title: Seating anyone, deliberately
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

An editor can seat any applicant by hand, a rejected one included, through the place dialog, warned and never blocked.
A seat held by someone not approved is a pin the run respects and a mark everyone sees, and every applicant can be found on the Vendors page.
No seat goes to an address the market has no application for.

## Why now

A hand placement accepted any address, the dialog offered only approved vendors, and a pin for someone not approved was silently orphaned by the next run while blocking nothing (research 6.1, state review conflict 4).
Decisions 3-6.

## Stories

- `S01` - a seat only for someone with an application.
- `S02` - the place dialog offers every applicant, warned.
- `S03` - not approved is marked wherever overrides show.
- `S04` - the Vendors page lists every applicant.
