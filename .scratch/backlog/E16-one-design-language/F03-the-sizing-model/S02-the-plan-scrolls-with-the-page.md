---
id: E16/F03/S02
title: The plan scrolls with the page
type: story
status: ready
blocked_by: [E16/F03/S01]
pr: []
---

## What to build

Delete `min-height: 320px` from `.plan-row`, and let the workspace scroll as a page rather than as a box inside a page.

The measurements, from ticket 01:

| | Natural height | Window it is given |
| --- | --- | --- |
| Plan, 3-date market | 1,032 | 547 |
| Plan, 1-date market (emptiest possible) | 812 | 521 |
| Assignment statistics | 1,055 | 536 |

The floor costs **268px of nothing on the emptiest possible market** and 69px on a real one. It is not what keeps a row even - `align-items: stretch` is, so the floor only sets the minimum of the *tallest* panel and deleting it cannot make a row ragged.

`.plan-row`'s own comment already states the model this story restores: *"Each row sizes to its own content; the page scrolls, not the rows."*

Six nested scrollers on Market Setup collapse with the cap. Keep only scrollers that are genuinely inside a bounded region; three of them also scroll horizontally by 4-8px, which is what produces the stub scrollbars inside the setup panels.

## Acceptance criteria

- [ ] No `min-height` on `.plan-row`.
- [ ] On a market with one date, one tier and one section, the entire plan is visible without scrolling inside any element.
- [ ] On a three-date market the page scrolls; nothing scrolls inside a panel except where a panel is genuinely bounded.
- [ ] No element on the market screens scrolls horizontally.
- [ ] No card clips its content mid-row at any content size (finding H13).

## Notes

The check-in page keeps its own behaviour; it is not an organizer screen.
