---
id: E15/F01/S03
title: Figures line up
type: story
status: done
blocked_by: []
pr: [77]
---

## What to build

Down the Vendors list the right-hand metadata starts at three different x positions - 1387, 1389, 1391 - because the group is right-aligned and Outfit's `0`, `1` and `2` are different widths, so the digits push the badge beside them around by a pixel or two per row.

The previous walk recorded this jitter on the Markets and Organizations rows without finding its cause. This is the cause.

Apply `font-variant-numeric: tabular-nums` wherever figures are stacked in a column: the Vendors counts, the Markets and Organizations rows, the assignment statistics, the tables counts. Prefer setting it once on a shared rule rather than per component; it costs nothing to apply too widely and is wrong nowhere that numbers are read vertically.

While here, two alignment defects with the same smell:

- **Assignment Results footer.** `Download CSV` sits at y=881 and `Send to Discord` at y=902, both 35px tall, in the same row. Nothing holds them to a shared baseline because the Discord hint is stacked above its button and the CSV button has no hint. The hint also sits *above* the control it explains and clears the card above it by 3px.
- **Check-in page.** The email input is 42px and `Look up` is 40px, both starting at the same y.

## Acceptance criteria

- [x] No column of figures shifts horizontally between rows. Asserted by measuring two rows with different digits and comparing the x of the element beside them.
- [x] `Download CSV` and `Send to Discord` share a baseline, and the Discord hint reads below or beside the control it explains, not above it.
- [x] The check-in field and its button are the same height.

## Notes

Startable now.
Evidence: `.lavish/aesthetics-2026-09-20.html`, H8, H7, H14.
