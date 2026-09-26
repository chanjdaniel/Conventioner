---
id: E21/F04
title: The frame stays put
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

On every market screen, the market's bar and its phase rail stay visible at any scroll position, the page is the only thing that scrolls, and every surface starts at the top and fills the height.

## Why now

Scrolling a tall surface carries the market's name, its tabs and its phase rail (with the action that moves the market on) out of sight.
Tables, Attendance and Vendors keep theirs in view only by capping their own height and scrolling inside the card, the nested scroller AGENTS.md forbids.

Prototyped and settled in [the-market-frame ticket 01](../../../wayfinding/the-market-frame/issues/01-how-the-frame-stays-put.md); the prototype is on the local branch `prototype/market-frame`, runnable with `?variant=A`.

## What is already settled, and must not be re-litigated

- **Variant A**: the bar and the full rail are one sticky block under the app banner, and the rail's growth (blocker panel, transition error, archived note) is pinned inside it. Condensing on scroll and floating the growth were both tried and rejected, for the reasons the ticket gives.
- **The page is the only scroller.** Sticky under a scrolling page, never a viewport-height shell. The banner is already sticky on this same principle (`App.vue`).
- **The banner has a fixed-height token**, and the frame sticks at it with no script.
- **One frame component** serves every market screen, with each screen's own title in it. Whether Tables, Attendance and Vendors carry the market's tabs is Topic 3's question, not this feature's.

## Stories

- `S01` - one frame, proved by Market Setup.
- `S02` - Tables, Attendance and Vendors stand in the frame, and stop scrolling inside their cards.
