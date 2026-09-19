---
id: E14/F02/S02
title: The rail reads as inert behind a modal
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

With the vendor detail drawer open, `.detail-overlay--open` intercepts pointer events across the whole page, the phase rail included.
"Publish Market" keeps its full green and looks live; clicking it closes the drawer instead of publishing.

Correct modal behaviour, wrong affordance.
Make the rail look as inert as it is while a drawer or dialog is open.

## Acceptance criteria

- [ ] While a modal overlay is open, no control behind it presents itself as available.
- [ ] Closing the overlay restores the rail's normal appearance.
- [ ] The scrim still closes the drawer on click - that behaviour is right and stays.

## Notes

Finding F13 in `.lavish/qc-2026-09-20.html`.
