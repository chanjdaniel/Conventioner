---
id: E12/F02
title: The vendor date card
type: feature
status: in-progress
blocked_by: []
pr: [72]
---

## Outcome

A vendor's date cards say what happened on each date: placed, placed against their answer, or not
placed and why.

## Why now

The cards exist and have the hole in them.
Each shows a date and a placement, or a date and a bare em dash - and gives both **the same green
left border**, so an unplaced date reads as placed at a glance.

## Build it once

Three states, one component.
The second state - placed against the vendor's stated preference - is `E11/F02/S02`'s pin override,
not a separate feature with its own UI.
Whichever of this and `E11/F02/S02` is taken second adds its state to the component the first built.
