---
id: E17/F02/S01
title: Plan-card rows render whole
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

An editable row inside a plan card renders complete - its raised edge visible on all four sides - instead of being cut off by the container that holds it.

One shared row treatment, so the fix reaches all six cards at once.

## Why it is broken today

Measured in the running app at 1920x1080. **The walk's diagnosis was half right, and the half that was wrong changes where the fix goes.**

The walk recorded that rows overhang their container's right edge and that the card body's padding is shorter than the shadow paints.
Measured, the rows do **not** overhang the card body: relative to its padding box, every row's right edge sits 0-9px *inside* it, and left and right insets are symmetric within each card.

What is actually true:

- **The clipping container is the rows list, not the card body.**
  The rows list carries `overflow-y: auto` with `overflow-x: hidden`, which establishes a clip on both axes.
- **The rows list overflows itself horizontally in four of six cards** - Market Dates, Location Setup, Section Setup and Assignment Options all report `scrollWidth > clientWidth` - and `overflow-x: hidden` silently clips the difference.
  The arithmetic behind it: a row takes `margin-left: 8px` and `margin-right: 8px` with `width: calc(100% - 8px)`, which totals `100% + 8px`.
- **The shadow has nowhere to paint.**
  The shared shadow's widest layer is `0 6px 14px`, which paints roughly 8px above a row, 20px below and 14px each side. The rows list clips at its own edge, so those pixels are discarded.

So the fix is the row's own width arithmetic plus the rows list's clipping - **not** the card body's padding, which is already 15/20/20/20 and adequate.

## Acceptance criteria

- [ ] The row width arithmetic is corrected so a row's margin box fits its container: no card reports `scrollWidth > clientWidth` on its rows list.
- [ ] A row's shadow renders whole on all four sides, including the first row's top edge and the last row's bottom edge. Verify by screenshot at 1920x1080 on a market with a populated plan, not by reading CSS.
- [ ] Vertical scrolling of a long row list still works; the clip that exists to make that possible is not simply removed.
- [ ] The fix lands in the shared row treatment so all six cards get it, rather than per card.
- [ ] The before/after `scrollWidth`/`clientWidth` numbers are quoted in the PR.
- [ ] `npm run lint:css` passes.
