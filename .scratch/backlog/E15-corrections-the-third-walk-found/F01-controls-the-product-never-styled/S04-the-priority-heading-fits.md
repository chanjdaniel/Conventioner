---
id: E15/F01/S04
title: The Priority heading fits its box
type: story
status: wontfix
blocked_by: []
pr: []
---

## What to build

The `Priority` heading in Tier Setup is 51px of text in a 48px box with `overflow` unset, so its last glyph is cut.
It is the only clipped text node found across thirteen measured screens, which is why it is worth fixing rather than absorbing into a layout change.

Give the heading the width its text needs, rather than widening the column - the column widths belong to [claims-and-room ticket 01](../../../wayfinding/claims-and-room/issues/01-how-an-organizer-screen-sizes-itself.md) and this story must not pre-empt it.

## Acceptance criteria

- [ ] No text node on `/market-setup` has `scrollWidth > clientWidth` while `overflow` is visible.
- [ ] The fix does not change any column width in Tier, Location or Section Setup.

## Notes

Startable now, and deliberately narrow: ticket 01 is about to rewrite this screen's layout and this story stays out of its way.
Evidence: `.lavish/aesthetics-2026-09-20.html`, H11.

## Not done here

**Absorbed by [E16/F03/S03](../../E16-one-design-language/F03-the-sizing-model/S03-columns-are-sized-by-need.md)** on 2026-09-20, when claims-and-room ticket 01 resolved.

This story was written to stay out of ticket 01's way while that ticket was open, by fixing the clip
without touching the column it sits in. The resolution rebuilds `.plan-row--triple` to size columns by
need and gives the header row a header's appearance, which is the same grid and the same header this
heading belongs to. Two changes to one grid, one of them deliberately narrow, is worse than one.

Kept rather than deleted so the record shows the narrow fix was considered and why it stopped being
the right shape.
