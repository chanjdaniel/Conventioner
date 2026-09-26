---
id: E21/F01/S02
title: A short surface starts at the top
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

An organizer on a market's Applications tab sees it directly beneath the header and rail, whatever the window height, the same as every other tab.

Today the whole market view vertically centres its content (`safe center`), so any surface shorter than the viewport floats to the middle and leaves a gap between the rail and the content.
The Applications tab shows it most, because with few applications it is the shortest surface.
The `safe` keyword was there so that overflowing content could not be stranded above the scroll origin; top alignment removes that hazard altogether.

Stretching a short surface to **fill** the height is not this story; it is [F04/S01](../F04-the-frame-stays-put/S01-one-frame-proved-by-market-setup.md), as decided in the map's [01](../../../wayfinding/the-market-frame/issues/01-how-the-frame-stays-put.md).

## Acceptance criteria

- [ ] Reproduced first in the running app: at 1920x1080, an Applications tab with few applications sits centred with a gap under the rail.
- [ ] At 1920x1080, every one of the four tabs starts directly beneath the rail, with no gap that depends on content height.
- [ ] Content taller than the viewport is still fully reachable by scrolling the page.
- [ ] A Playwright check pins the Applications tab's top edge to the rail's bottom edge on a market with no applications.
