---
id: E17/F01
title: The controls nobody owns
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

The two controls that were re-decided in every file that used them - the add-row `+` and the drag handle - are owned once by the primitives layer, and every plan card that carries them looks and behaves the same.

## Why now

Neither control has an owner anywhere in the codebase.
The add-row wrapper class appears in four plan cards and is styled in none of them; where the control looks centred it is centred by accident of a parent that happens to be a centred flex column.
The icon rule beside it is declared identically in five files, and one card's markup names a class that matches nothing - which is why that card's icon renders at a different size from the other four and its label falls below it.
The drag handle is two hairline strokes at quarter opacity with a hardcoded colour that overrides the one its wrapper sets, so it can be neither themed nor given a hover state.

A token cannot stop a file deciding these again.
A primitive can, which is the lesson `E16` already paid for.

## Stories

- `S01` - one add-row control, adopted by all five plan cards.
- `S02` - the drag handle reads as a handle.
- `S03` - plan-card headings and values share one grid.
