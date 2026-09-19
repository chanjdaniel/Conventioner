---
id: E09/F03/S01
title: Setup row controls are the size and shape they claim
type: story
status: done
blocked_by: []
pr: [69]
---

## What to build

Three defects on the rows that build every tier, location and section, all measured in the running build:

- **The delete icon is crushed.**
  `icon-close-round` declares 24x24 and renders **8x20** inside a 10px-wide flex cell on tier and location rows.
  The identical icon on a section row renders correctly at 24x24; the two sit side by side on one screen.
- **The drag handle overflows its container.**
  Its SVG is 16x56 inside a 29x38 cell, so the grip lines are clipped top and bottom and read as a rendering error rather than a handle.
- **The delete control is not a control.**
  It is a `<div>` with `cursor: auto`, `tabIndex -1`, no role and no accessible name, in a 10px hit target.

The reveal-on-hover dimming at 0.35 opacity is deliberate (`E08/F02` made it dimmed rather than hidden) and stays, though it should be checked against AA now that a standard exists.

## Acceptance criteria

- [ ] The delete icon renders square, at the same size, on tier, location, section and market-date rows.
- [ ] The drag handle renders inside its cell.
- [ ] Delete is a `<button>` with an accessible name, reachable by keyboard, with a hit target of at least 24x24.
- [ ] The dimmed state meets the contrast standard from `F01/S01`.
