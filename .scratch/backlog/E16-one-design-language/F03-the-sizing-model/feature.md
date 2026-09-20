---
id: E16/F03
title: The sizing model
type: feature
status: done
blocked_by: []
pr: [77]
---

## Outcome

Every organizer screen is a card of one of two widths that grows to its content while the page scrolls. No screen caps its own height, no row carries a minimum height, and no column is sized by how many columns there are.

## Why now

This is the build of [claims-and-room ticket 01](../../../wayfinding/claims-and-room/issues/01-how-an-organizer-screen-sizes-itself.md), resolved 2026-09-20. That ticket holds the measurements and the reasoning; nothing here re-opens them.

It sits before the primitives deliberately. `.field` has to be wide enough for its own content, and the Tier select is 65px only because `.plan-row--triple` is equal thirds - so the layout has to be right before a control primitive can be judged against it.

## What it closes

Five findings from `.lavish/aesthetics-2026-09-20.html` resolve here with no separate work, which is why none of them appears in `E15`:

- **H1** - the Tier select rendering at 65px, unable to display any of the three values it offers.
- **H10** - column headers styled identically to the editable pills beneath them; they are the header row of a grid being rebuilt.
- **H13** - content cut mid-row at the bottom of every capped card.
- **O1** - four page widths and four gutters across the product.
- **O2** - the 320px name cell inside an 1840px Markets row.

## Stories

- `S01` - the two widths replace the four.
- `S02` - the plan scrolls with the page.
- `S03` - the plan's columns are sized by need.
