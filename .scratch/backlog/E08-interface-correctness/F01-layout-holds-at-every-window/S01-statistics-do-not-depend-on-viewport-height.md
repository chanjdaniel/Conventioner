---
id: E08/F01/S01
title: Assignment statistics do not depend on viewport height
type: story
status: done
blocked_by: []
pr: [04215fc0]
---

## What to build

The four statistics lists on the assignment results page show their content at any window size a
laptop has. At 1366x768 today they show a title and a sliver of clipped content that bleeds outside
the card border and overlaps the card below.

## Acceptance criteria

- [x] At 1280x720 the per-date list shows its rows, or scrolls within a card whose height is intrinsic rather than inherited from the viewport.
- [x] No card's content renders outside its own border or over the card beneath it, at any size in the table below.
- [x] Verified at 1280x720, 1366x768, 1440x900, 1512x982, 1600x900, 1920x1080 and 2560x1440.
