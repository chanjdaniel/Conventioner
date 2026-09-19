---
id: E12/F02/S01
title: Three states, one card
type: story
status: in-progress
blocked_by: []
pr: [72]
---

## What to build

The vendor detail panel's per-date card becomes one component with three states:

1. **Placed** - the table, section, tier and location, as now.
2. **Placed against their stated preference** - a placement that overrides the vendor's own answer,
   from `E11/F02/S02`. Tier sets the price, so a vendor charged for a table they did not choose must
   be visible as such.
3. **Not placed** - with the reason from `E12/F01/S01`.

The three read differently at a glance.
Today an unplaced date carries the same green left border as a placed one and a bare em dash for
content, which is the defect.

## Acceptance criteria

- [ ] An unplaced date is distinguishable from a placed one without reading the text.
- [ ] Every unplaced date states its reason in words, never as punctuation.
- [ ] A "free" reason is actionable - it leads to the Tables view where the vendor can be placed
      (`E11/F03`), rather than merely reporting.
- [ ] One component serves all three states; there is no second override-marking UI anywhere.
