---
id: E11/F03/S02
title: The vendor panel opens the Tables view where the change happens
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The vendor detail panel gains "change placement", which opens the Tables view filtered to that
vendor's date.

This is the story that **makes the Tables view's filters reachable**.
`dateFilter`, `sectionFilter`, `tierFilter` and `choiceFilter` are computed from `route.query`, the
chips can clear a filter, and nothing in the product ever sets one - so a complete filter system
exists that no organizer can invoke.

Coordinate with `E09/F02/S01`, which carries the same acceptance criterion.
Whichever lands second should find it already done.

## Acceptance criteria

- [ ] "Change placement" on a vendor opens the Tables view scoped to the relevant date.
- [ ] The filters can be set from the page, not only cleared.
- [ ] Returning from the Tables view does not lose the vendor panel's context.
