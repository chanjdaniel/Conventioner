---
id: E17
title: Corrections the fourth walk found
type: epic
status: done
blocked_by: []
pr: []
---

## Outcome

The findings from the 2026-09-21 manual QC walk that carry no decision are fixed: the add-row control and the drag handle are owned once instead of re-decided per file, space delineates structure instead of hiding it, and captions line up with the controls they name.

## Why now

A manual quality-control walk on 2026-09-21 against `dev @ 26cf49fe` produced `.scratch/qc/2026-09-21-manual-qc.md`.
Its 28 items split the way `E09`, `E14` and `E15` split before it: the ones that are open decisions became the Wayfinder map [the-order-of-the-work](../../wayfinding/the-order-of-the-work/map.md), and what is left is here - each with exactly one right answer and a mechanism already verified in the source.

This is that pattern, fourth time round.

## Relationship to the map

Some findings were held back because a map ticket might delete the surface they sit on.
Their status as the map resolves:

- **`F03`** (the create-market name field has no border) - **answered by [ticket 08](../../wayfinding/the-order-of-the-work/issues/08-what-a-dialog-is-in-this-product.md)** on 2026-09-22 and not in this epic.
  That ticket makes every dialog field reach for `.field` in `primitives.css` and drop the `all: unset` that would defeat it.
- **`F05`** (the Market Dates picker opens on the left) - **`wontfix`**, released 2026-09-22.
  [Ticket 02](../../wayfinding/the-order-of-the-work/issues/02-what-the-draft-workspace-looks-like.md) replaced the row-based date control with a calendar, so there is no native date input left to position.
- **`F12`** (the "Ask this" toggle sits inline with the ranking badge) - **released into this epic** on 2026-09-22.
  [Ticket 04](../../wayfinding/the-order-of-the-work/issues/04-what-the-form-asks-and-in-how-many-shapes.md) does not touch the toggle.

`P1` (Enter submits) is not here: its missing half is the four dialogs ticket 08 is about, and the pattern the six already-working cases should converge on is that ticket's to pick.

`F04` (the settings panel has no outer gutter) **is** here, although [ticket 02](../../wayfinding/the-order-of-the-work/issues/02-what-the-draft-workspace-looks-like.md) replaces that panel with a full-width ordered page.
It is a one-line fix on the surface MVP serves today, and this epic ships first.

## Features

Sliced 2026-09-22 with `/to-tickets`, informed by measurements taken in the running app at 1920x1080 against a market with a populated plan.
Those measurements corrected two of the walk's diagnoses - see `F01/S03` and `F02/S01` - so read a story before assuming the QC report's mechanism still stands.

- **[`F01` - The controls nobody owns](F01-the-controls-nobody-owns/feature.md).**
  The add-row `+` and the drag handle, owned once by the primitives layer instead of re-decided per file, and the column grids that depend on them.
  Three stories; `S03` is blocked by `S01` and `F02/S01`.

- **[`F02` - Space that shows structure](F02-space-that-shows-structure/feature.md).**
  Plan-card rows that render whole, and three unrelated spacing faults too small to carry their own context.
  Two stories, both startable now.

- **[`F03` - Alignment and type](F03-alignment-and-type/feature.md).**
  The application form tab read as one screen, and the shared action button set at the size the scale names for buttons.
  Two stories, both startable now.

- **[`F04` - The top bar never scrolls away](F04-the-top-bar-never-scrolls-away/feature.md).**
  One story, startable now, with one constraint that makes it less trivial than it looks.

## The frontier

Seven of the eight stories are startable immediately.
`E17/F01/S03` is the only blocked one, waiting on `E17/F01/S01` and `E17/F02/S01` - judging column alignment against rows that are still clipped, or against an add control that is still mis-sized, would mean measuring twice.
