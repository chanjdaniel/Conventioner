---
id: E15
title: Corrections the third walk found
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

The findings from the 2026-09-20 aesthetics walk that carry no decision are fixed: every control renders in the product's own typeface, every column of figures lines up, and no screen shows the organizer a value meant for the database.

## Why now

A Playwright walk over every organizer screen, the public check-in page and the auth screens on `dev @ 1aac84c6`, at 1920x1080 against a realistic fixture, produced `.lavish/aesthetics-2026-09-20.html`.
Its findings split three ways. The system-level ones became [E16](../E16-one-design-language/epic.md) and `docs/design-system.md`. The ones that need a decision about what a screen should *say* are deliberately not started - see below. What is left is here: each has exactly one right answer and nothing to debate.

This is the `E09` / `E14` pattern, third time round.

## Relationship to E16 and to the map

- **Colour is not here.** Every colour finding - the nine reds, the two blues, the undefined tokens, the two failing verdict buttons, the phase-rail ground, the logo - is [E16/F01](../E16-one-design-language/F01-every-colour-has-a-name/feature.md), because they are one edit to the palette rather than nine edits to nine files. Do not fix them here.
- **Nothing here changes how a screen sizes itself.** [claims-and-room ticket 01](../../wayfinding/claims-and-room/issues/01-how-an-organizer-screen-sizes-itself.md) resolved on 2026-09-20 and its build is [E16/F03](../E16-one-design-language/F03-the-sizing-model/feature.md), which absorbs the 80% cap, the truncated tier select, the input-styled column headers and the content cut mid-row. `F01/S04` was written narrow to stay out of its way and is now `wontfix` for the same reason.
- **Nothing here changes who is in the Vendors list.** That is [ticket 04](../../wayfinding/claims-and-room/issues/04-who-is-in-the-vendors-list.md); this walk only confirmed it with a bigger fixture (eleven of fourteen rather than one of six).
- **The floorplan editor is left alone.** Its `#00ff00` selection stroke and its beige page are real, but the floorplan GUI is cut from MVP and fixing it now spends attention on a surface nobody reaches.

## Deliberately not started

Six findings are genuine open decisions about what a screen should say and emphasise, not what it should look like: what a market row's button should do, what the dashboard is for, what a triage card leads with, what an empty state is in this product, and what chrome the import wizard wears.
A token scale fixes none of them.
They want their own Wayfinder map, charted after `claims-and-room` closes - ticket 01 will already have answered part of it.

## Features

- `F01-controls-the-product-never-styled` - the Arial fallback, the synthesised bolds, the ragged figure columns, the misaligned footer. (The clipped heading, `S04`, is `wontfix` - absorbed by `E16/F03`.)
- `F02-screens-that-show-their-internals` - a raw `true`, a raw `market_days`, screens that do not name their market, and a check-in page whose primary action is its quietest control.
