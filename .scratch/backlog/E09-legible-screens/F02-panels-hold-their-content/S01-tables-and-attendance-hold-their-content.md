---
id: E09/F02/S01
title: The Tables and Attendance views hold their content
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The Tables view shows every table for every market date, reachable by scrolling.
The Attendance view sizes itself to what it holds.

Today `.tables-card` is `overflow: hidden` at a fixed viewport-derived height, and `.tables-body` inside it is `overflow: visible`.
Nothing scrolls: the document scrolls 45px and stops.
Measured on a two-date, twelve-table market: card clientHeight **820** against scrollHeight **2762**, body clientHeight **671** against scrollHeight **2684**.
About 1,940px of table rows are painted outside the clip and are unreachable, including the whole of the second market date.
The Back button is drawn over the sixth table's card because the list has overflowed onto the action row.

`AttendanceStatusView` has the same fixed-height card and the opposite symptom: an 820px white slab holding about 200px of content.

**The view also has a complete filter system that cannot be reached.**
`dateFilter`, `sectionFilter`, `tierFilter` and `choiceFilter` are computed from `route.query`, and
the chips render only when a filter is already set.
They can *clear* a filter; nothing anywhere in the product ever *sets* one.
So a 24-row, two-date market has working date and section filtering that no organizer can invoke -
which is why the view reads as an unfiltered wall.

## Acceptance criteria

- [ ] Every table on every market date is reachable on the Tables view at 1920x1080.
- [ ] The date, section, tier and table-choice filters can be set from the page, not only cleared.
      `E11/F03/S02` carries the same criterion, because the vendor panel opens this view filtered;
      whichever lands second should find it already done.
- [ ] The Back button never overlaps a table row.
- [ ] The Attendance view's card is the height of its content, including when that content is a single empty-state line.
- [ ] Both fixes come from the same structural change, not two different ones.
- [ ] An e2e assertion pins that the last table of the last market date is visible after scrolling, so the next instance of this fails a test rather than a walk.

## Notes

Whether this pattern appears anywhere else is deliberately left open - it sits in the map's **Not yet specified**, and only sharpens once this lands and shows what else shares these class names.
