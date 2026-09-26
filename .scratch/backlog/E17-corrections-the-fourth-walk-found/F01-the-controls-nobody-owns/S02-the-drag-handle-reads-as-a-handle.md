---
id: E17/F01/S02
title: The drag handle reads as a handle
type: story
status: done
blocked_by: []
pr: []
---

## What to build

The control an organizer drags to reorder a row looks like something you can pick up, before they hover it.

It is used in three places - the application form's field list, Tier Setup and Assignment Priority - so one icon change reaches every reorderable list in the product.

## Why it is broken today

The icon is an 8x28 SVG containing two vertical strokes at `stroke-width: 0.8`, wrapped in a group at `opacity: 0.25`, stroked with a hardcoded hex.

Three consequences:

- Two 0.8px hairlines at quarter opacity are close to invisible on white.
- Two parallel lines are not the shape any interface uses for this; the convention is a grid of dots or stacked grip lines, which read as texture to grip rather than as a divider.
- The hardcoded colour **overrides** the colour its wrapper sets, so the handle cannot be themed from CSS and cannot be given a hover state.

Its hit area is a 16px-wide box around an 8px icon - for a drag control.

## Acceptance criteria

- [ ] The icon is a recognisable grip - a dot grid or stacked grip lines - not two parallel strokes.
- [ ] The icon inherits `currentColor` and carries no hardcoded colour value, so its wrapper's colour applies.
- [ ] The handle has a visible hover state, achieved through the wrapper's colour rather than a second icon.
- [ ] The hit area is proportionate to a drag control rather than to the icon's drawn width; state the chosen size in the PR.
- [ ] All three consumers are updated and verified: the application form's field list, Tier Setup and Assignment Priority. The plan cards are narrower than the field list, so confirm the larger target does not disturb their column widths.
- [ ] Reordering still works by dragging the handle in all three places.
- [ ] `npm run lint:css` passes.
