---
id: E21
title: The market frame
type: epic
status: done
blocked_by: []
pr: []
---

## Outcome

Every market screen sits in one frame that stays put and tells the truth.
The market's header and phase rail stay visible at any scroll position, the tabs are readable in every state, each surface starts at the top and fills the height, and everything the frame and its surfaces show follows the market the moment it changes, not when a tab is reopened.

## Why now

Four findings from the 2026-09-26 brain dump, all on the frame around a market rather than on any one surface:

- Scrolling a tall surface carries the market's name, its tabs and its phase rail out of sight.
- Hovering a tab turns its label the colour of the bar behind it.
- On a short window the Applications tab floats in the middle of the screen.
- Opening, closing or reopening applications does not reach the form builder until the organizer leaves the tab and comes back.

Charted in [the-market-frame](../../wayfinding/the-market-frame/map.md).
The scope grew while grilling: the back end becomes the only source of truth about a market, and nothing about one is kept in the browser.
The map is closed: every question is resolved, and the four features below are the whole of the work.

## Features

- `F01` - two plain fixes: a readable tab hover, and surfaces that start at the top. Startable now.
- `F02` - one market, from the server: one store, id-addressed screens, re-fetch after every write, nothing in the browser. Fixes the reported form-builder bug.
- `F03` - each write names what it changes: the plan saves only the plan, a market's organization is fixed, a rename happens only in draft, no two markets share a public address, and the whole-market PUT is deleted.
- `F04` - the frame stays put: the bar and the full rail pin under the banner on every market screen, and the page is the only scroller.

## Order inside this epic

`F01`, `F03/S01` and `F03/S03` are independent and startable now.
`F02` runs `S01`, then `S02` and `S04` (either order), then `S03` and `S05`.
`F03/S02` follows `F02/S02`, because the plan's working copy is where its write comes from.
In `F03`, `S04` follows `S03`, `S05` follows `S01`, and `S06` comes last.
`F04/S01` follows `F01/S02`, then `F04/S02`.
`F02/S02` and `F04/S01` both rework `MarketSetupView`; they are independent, but running them one after the other rather than side by side avoids a painful merge.
