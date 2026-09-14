---
id: E08/F01/S02
title: No page scrolls horizontally because it scrolls vertically
type: story
status: done
blocked_by: []
pr: [04215fc0]
---

## What to build

`width: 100vw` includes the vertical scrollbar, so any page tall enough to scroll gains a horizontal
scrollbar it does not need. Observed on the assignment results page, the review queue and the public
check-in page: `documentElement.clientWidth` 1425 against elements laid out at 1440.

Four declarations in `front-end/src/App.vue` (lines 92, 111, 136, 146) and one `max-width: 100vw` in
`front-end/src/assets/main.css`.

## Acceptance criteria

- [x] No organizer page has `scrollWidth > clientWidth` at any size from 1280x720 up.
- [x] Full-bleed elements still reach both edges.
