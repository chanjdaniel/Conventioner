---
id: E17/F04/S01
title: The top bar never scrolls away
type: story
status: done
blocked_by: []
pr: []
---

## What to build

The top bar - the logo and the navigation menu button - is visible at every scroll position, on every page, and behaves identically on authenticated screens and public pages.

An organizer deep in a long market plan can reach the navigation without scrolling back up.

## Why it is broken today

The header is an ordinary in-flow element at the top of the app shell, so on any page tall enough to scroll it scrolls off with the content and the navigation becomes unreachable.

## The constraint that makes this less trivial than it looks

The app shell is deliberately `min-height: 100vh` and **grows past the viewport so the page scrolls**.
It used to be pinned to the viewport with `position: absolute; height: 100vh`, which meant no screen could scroll the page and every tall screen had to handle its own overflow internally - that is where the market plan's nested scrollers came from, and why its card was capped at a percentage of the viewport in the first place.

**Do not reintroduce a viewport-height shell with an internal scroller to achieve this.**
The fix belongs on the header itself.

## Acceptance criteria

- [ ] The top bar is visible at any scroll position on every page, authenticated and public alike.
- [ ] The app shell keeps growing past the viewport and the **page** is what scrolls; no new nested scroll container is introduced anywhere.
- [ ] The navigation drawer still opens, closes and traps focus correctly with the bar pinned, and the drawer's off-screen state still keeps its links out of the tab order.
- [ ] Content at the top of a scrolled page is not hidden behind the bar.
- [ ] Verified on a page long enough to scroll - the market workspace with a populated plan - at 1920x1080, by screenshot at top and mid-scroll.
- [ ] The public check-in page is checked too: it is the one surface held to a phone requirement.
- [ ] `npm run lint:css` passes.
