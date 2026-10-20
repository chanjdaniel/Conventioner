---
id: E35
title: The vendor, one click away
type: epic
status: done
blocked_by: [E31]
pr: []
---

## Outcome

Wherever a vendor appears (the Vendors list, a seat in the results, an attendance entry, the bulk review), one click opens the same vendor drawer, and from it one click reaches that vendor's table to change it.
The results can be searched for a vendor, the statistics read at a glance, and the assignment download names each vendor in full.

## Why now

The [2026-10-19 brain dump](../../brain-dump/2026-10-19.md): the organizers wanted a vendor's details from a seat and from the door, the drawer buries assignments and history at the bottom, and Change placement opens the results with nothing carried over.
Settled in the same day's grilling (decisions 13-16, 18, 28, 30).
Feature work, so it waits for the November 2026 market window to close (2026-11-21).

## Features

- `F01` - one vendor drawer.
- `F02` - finding a vendor's table.
- `F03` - the results read better.

## Order inside this epic

`F01/S01` first: every other surface opens it, and `E34/F04/S01` does too.
`F02/S01` before `F02/S02`, which sets its search.
`F03` is independent.
