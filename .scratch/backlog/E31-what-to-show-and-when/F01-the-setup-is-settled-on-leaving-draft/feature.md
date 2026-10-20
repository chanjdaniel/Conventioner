---
id: E31/F01
title: The setup is settled on leaving draft
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

A market leaves draft only with a complete setup, and from then on nothing on Market Setup changes: the intake mode, the dates, the locations, the sections and their table counts, the tiers and the floorplan.
The way back to draft, open only while no application exists, is the only way to change it.

## Why now

Settled in the map's [round 1 and 2](../../../wayfinding/what-to-show-and-when/map.md#settled-while-charting) and [ticket 02](../../../wayfinding/what-to-show-and-when/issues/02-the-next-step-per-phase-and-path.md).
Today everything on Market Setup saves in every phase but archived, so a date can be removed after vendors chose it and a section emptied after they were placed in it.

## Stories

- `S01` - leaving draft requires a complete setup.
- `S02` - the setup refuses changes once the market has left draft.
- `S03` - Market Setup reads as settled.
