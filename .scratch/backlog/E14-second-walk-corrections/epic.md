---
id: E14
title: Second-walk corrections
type: epic
status: done
blocked_by: []
pr: [75]
---

## Outcome

The findings from the 2026-09-20 walk that carry no decision are fixed: no organizer screen states a small falsehood, and the rough edges the five epics left behind are gone.

## Why now

A Playwright walk over every organizer flow `E09` through `E13` touch, on `dev @ 45f15e00`, found fourteen things (`.lavish/qc-2026-09-20.html`).
Five carry a decision and are on [Map: Claims we can support, and room to show them](../../wayfinding/claims-and-room/map.md).
The rest are here: they resolve nothing, and two of them are one-liners sitting in front of an organizer right now.

Four of these are regressions the five epics introduced into their own territory.
That is worth saying plainly rather than filing quietly - the duplicated year in particular was introduced by `E09/F04/S02`, *the "one date format" story*, which rewrote `getFormattedDate` to include the year and did not update the one caller whose whole job was to add it.

## Relationship to the map

Stories here stop short of anything the map is deciding.
In particular:

- Nothing here changes how a screen sizes itself - that is map ticket 01, and it absorbs the 80% cap, the 320px panel minimum and the truncated section columns.
- Nothing here changes where a screen gets its market - that is map ticket 02.
- The check-in page's scrollbar *is* here, because the check-in page is not an organizer screen and was carved out of the sizing question deliberately.

## Features

- `F01-screens-that-state-a-falsehood` - the dashboard's empty state, the duplicated year, the blocker's resolution link.
- `F02-rough-edges` - the check-in page's phantom scrollbar, the rail reachable behind a modal, the amber zero, and then every other modal in the product.

## It grew by one story

`F02/S02` found that the vendor drawer declared `aria-modal="true"` while the controls behind it stayed in the tab order, and deliberately fixed only that one rather than widening itself.
`F02/S04` is the sibling it named, and it turned out to be thirteen modals rather than the five that story guessed at - three of which a hand survey missed entirely, and three more that only came to light when review asked what the guard could not see.

## Corrected on the way through

Two of the fourteen findings were not what the walk recorded, and the stories say so where they say it:

- The rail behind the vendor drawer is not "left lit".
  The scrim dims everything behind it to a measured 60%, the rail no more brightly than its neighbours.
  What was wrong is that fourteen controls behind the drawer stayed in the tab order, so "Publish Market" could be tabbed onto and fired with Enter - a stronger claim to being available than any colour makes.
- The blocker link did not point at `/market-setup` from every guard.
  Two pointed at `/assignment-results`, which is a redirect to the assignment tab, and one already named a tab - the wrong one.
