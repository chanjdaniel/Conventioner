---
id: E15/F02/S04
title: Check in is the primary action
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

On the check-in result, `Look up` - the action the vendor has already completed - is the only solid green button on the page.
`Check in`, the entire purpose of the surface, is a white outline button in the bottom-right corner of each day card with a 25px void above it.

This is the one surface someone holds in their hand at a door with a queue behind them.

- `Check in` becomes the solid primary, full width inside its day card.
- `Look up` demotes to secondary once a result is showing.

The 390px rendering is otherwise the best-executed surface in the product - no horizontal scroll, no overflowing element, no contrast failure - so change the emphasis and the placement, not the layout.

## Acceptance criteria

- [ ] `Check in` is the only primary-styled control on the result view, at both 1920x1080 and 390x844.
- [ ] The check-in e2e spec asserts which control is primary, not just that it exists.
- [ ] 390px still reports no horizontal scroll and no contrast failure.

## Notes

Startable now.
This is the one finding from the "organization" group that carries no decision - the primary action being the primary button is not a matter of taste. The rest of that group is deliberately not started; see the epic.
Evidence: `.lavish/aesthetics-2026-09-20.html`, O4.
