---
id: E21/F01/S02
title: A short surface starts at the top
type: story
status: done
blocked_by: []
pr: []
---

## What to build

An organizer on a market's Applications tab sees the market directly beneath the app banner, whatever the window height, the same as on every other tab.

Today the whole market view vertically centres its content (`safe center`), so any surface shorter than the viewport floats the whole card, header and rail with it, to the middle of the window, leaving a gap under the app banner (272px at 1920x1080 on an empty Applications tab).
The Applications tab shows it most, because with few applications it is the shortest surface.
The `safe` keyword was there so that overflowing content could not be stranded above the scroll origin; top alignment removes that hazard altogether.

Stretching a short surface to **fill** the height is not this story; it is [F04/S01](../F04-the-frame-stays-put/S01-one-frame-proved-by-market-setup.md), as decided in the map's [01](../../../wayfinding/the-market-frame/issues/01-how-the-frame-stays-put.md).

## Acceptance criteria

- [x] Reproduced first in the running app: at 1920x1080, an empty Applications tab sits centred with a 272px gap under the banner.
- [x] At 1920x1080, every one of the four tabs starts directly beneath the banner, with no gap that depends on content height.
- [x] Content taller than the viewport is still fully reachable by scrolling the page.
- [x] A Playwright check pins the market card's top edge to the banner's bottom edge on every tab of a market with no applications.
