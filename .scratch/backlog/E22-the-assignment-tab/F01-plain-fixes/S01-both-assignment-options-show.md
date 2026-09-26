---
id: E22/F01/S01
title: The Assignment Options card shows both options
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

An organizer on a market's Assignment tab sees both assignment options in full: Max assignments per vendor, and Max half table proportion per section, with its explanation and the bottom edge of its box.

Today, at 1920x1080, the second option is cut off by 30px.
The options' list is its own scroller (`overflow: auto`) sized to the card's height rather than to its content, so the bottom of the second option sits below a scrollbar nobody sees.
AGENTS.md (**The Design Language**) forbids a frame screen growing a scroller of its own: the page is the only scroller.

## Acceptance criteria

- [x] Reproduced first in the running app: on a market with the Assignment tab open at 1920x1080, the half-table option's box is clipped.
- [x] Both options show in full at 1920x1080 and at 1280x800, with no scroller inside the card.
- [x] A Playwright check fails if any element inside a market screen's surface scrolls on its own (content taller than its box, with `overflow` other than `visible`) - so the next nested scroller is caught by name rather than by eye.
