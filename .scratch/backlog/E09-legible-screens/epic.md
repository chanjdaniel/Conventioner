---
id: E09
title: Legible screens
type: epic
status: done
blocked_by: []
pr: [69]
---

## Outcome

Every screen in the MVP journey can be read at the window sizes an organizer uses, shows all of its own content, and offers controls that look like controls and say what they do.

## Why now

A second full journey walk on 2026-09-15 (`.lavish/qc-2026-09-15.html`) found one screen that cannot be read at all, two design-system colours that have never met WCAG AA, and roughly twenty first-contact defects around them.
None of them carries a decision, which is why they are here and not on [Map: A journey you can read](../../wayfinding/readable-journey/map.md).

The findings that *do* carry decisions are on that map: the lifecycle and publish model, what names a vendor, whether the tokens carry a contrast contract, what the product says when a vendor cannot be placed, and whether the importer can match before it splits.
Stories here that touch those areas say so and stop short of the decision.

## Relationship to E08

`E08` did this job once, on 2026-09-14, and its `F01` outcome overclaimed: it read "Every organizer screen is readable and free of spurious scrollbars from 1280x720 upward" while its three stories covered the statistics lists, the `100vw` scrollbar and the Applications tab.
The Tables view was never a story and is this epic's worst finding - the same shape of bug as the Applications tab story that was fixed.
`E08/F01`'s outcome has been amended to name the three screens it actually covered.
`E08/F02` stays open; its "Still to do" is genuinely blocked on a decision, now split between map ticket 02 and the out-of-scope price question.

## Out of scope

- The market id in the URL.
  Guarding the no-market case is `F05/S02` here; routing by market id is ruled out of scope on the map.
- Bulk approve.
  Decided against deliberately by `real-market-readiness` ticket 04.
- Price per tier, and therefore the vendors table's Cost column, which stays an em-dash.
  `F04/S01` makes the column say why rather than leaving it looking broken.
