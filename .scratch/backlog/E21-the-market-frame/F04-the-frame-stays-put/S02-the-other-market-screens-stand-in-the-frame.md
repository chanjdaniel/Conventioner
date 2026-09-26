---
id: E21/F04/S02
title: Tables, Attendance and Vendors stand in the frame
type: story
status: done
blocked_by: [E21/F04/S01]
pr: []
---

## What to build

The three other screens with a phase rail use the same frame as Market Setup, each with its own title in it, and stop scrolling inside their cards.

Today each of them caps its card at the viewport and scrolls a body inside it (`max-height: 100%`, `overflow: hidden`, a scrolling body).
That is how they keep their header in view, it is the nested scroller AGENTS.md forbids, and it is why a sticky header cannot work there: a sticky element inside an `overflow` ancestor silently stops sticking.
The cap and the inner scroller go; the page scrolls, and the frame keeps the title and the rail in view.

An organizer working down a 40-table list on Tables, a long check-in list on Attendance, or the vendor list on Vendors keeps the market's name and rail in view, and scrolls with the page's own scrollbar and the mouse wheel anywhere on the screen.
Anything these screens pin today for its own reasons (a filter row, an actions row) is either inside the frame or scrolls with the page; nothing keeps its own scroller.

## Acceptance criteria

- [x] Tables, Attendance and Vendors use the frame component with their own titles, and none of them caps its height or scrolls inside its card.
- [x] At 1920x1080, scrolling each to the bottom keeps the title and the whole rail visible under the banner.
- [x] On each of the four frame screens the page is the only vertical scroller, and an e2e spec asserts it.
- [x] Any control these screens kept in view by the old inner scroller is still reachable at any scroll position.

## Built differently, on purpose

The Back rows are in the frame's `footer` slot, which sticks to the bottom of the window, rather than scrolling away with the page: the acceptance criteria require that a control the old inner scroller kept in view stays reachable at any scroll position.
The three list screens now sit flush under the banner like Market Setup (their 40px top gutter went) and keep their card radius.
