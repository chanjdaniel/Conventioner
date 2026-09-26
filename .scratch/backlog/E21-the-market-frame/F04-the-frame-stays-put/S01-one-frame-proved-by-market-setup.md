---
id: E21/F04/S01
title: One frame, proved by Market Setup
type: story
status: done
blocked_by: [E21/F01/S02]
pr: []
---

## What to build

A market frame that stays put, with Market Setup as the first screen in it.

An organizer scrolling a long plan, form or applications list keeps the market's name, its tabs and its phase rail in view the whole way down, and can press the rail's forward action from anywhere on the page.
A refused transition's blocker panel appears inside the pinned frame, directly under the button that caused it.
Switching tab starts the new tab at its own top, directly under the frame, rather than wherever the last tab was scrolled to.
A short tab still fills the window: the card reaches at least the bottom of the viewport.

**The frame component** owns the sticky block (a title slot and the rail), its offset under the app banner, and filling the height.
**The banner gets a fixed-height token**, and the frame sticks at it; nothing measures the banner at run time.
It is the design system's first sticky layer beneath the banner, so `docs/design-system.md` and `base.css` gain the token, and AGENTS.md's Design Language entry says the frame sticks beneath the banner on the same principle.

`F01/S02` removes the vertical centring first; this story adds the fill.

## Acceptance criteria

- [x] At 1920x1080 on each of the four tabs, scrolling to the bottom leaves the market name, the tabs and the whole rail visible and unmoved under the banner.
- [x] A refused transition's blocker panel is inside the pinned frame, and closing or resolving it returns the frame to its one-line height.
- [x] Switching tab while scrolled lands at the new tab's top, with nothing hidden under the frame.
- [x] On a tab shorter than the window, the card reaches the bottom of the viewport.
- [x] The banner's height is a token, the frame sticks at it, and there is no `ResizeObserver` or scroll handler doing either job.
- [x] No ancestor of the frame has an `overflow` that would stop it sticking, and an e2e spec asserts the frame's position after scrolling on each tab.

## Built differently, on purpose

`--banner-h` is `clamp(30px, 5vh, 100px)` - the value the banner already came to - rather than a single pixel height.
The point of the decision was that nothing measures the banner at run time, and nothing does; a flat pixel value would have changed the banner's size at every other window height, which no story asked for.
