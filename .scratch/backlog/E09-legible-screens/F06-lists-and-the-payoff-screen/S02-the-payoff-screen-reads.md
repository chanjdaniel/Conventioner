---
id: E09/F06/S02
title: The payoff screen reads
type: story
status: in-progress
blocked_by: []
pr: [69]
---

## What to build

- **Two columns are empty and stretched.**
  Per Date and Per Section are sized to the height of Unassigned Tables, so the organizer scrolls about 1,300px of blank white to reach the bottom of the page.
  On a run with no applications at all, both are entirely empty cards with a heading and a rule.
- **Tables sort lexicographically**: Front Row1, Front Row10, Front Row11, Front Row12, Front Row2, Front Row3.
  Table 2 is fifth.
- **Every row repeats its date** under a heading that already states it, and the date is the widest text in the row, so the table name wraps onto two lines.
- **"Satisfaction Score"** has no definition, no breakdown and no tooltip anywhere in the product.
  On an empty run it reads 0.0%, which looks like a bad result rather than no result.
- **Per Tier omits a tier with no assignments** rather than showing it at zero, which is exactly the row that explains a failed run.
- **Assignment runs on a market with no approved applications** and produces a screen that looks like a completed run: 0 assignments, 0/24 tables, 0/0 vendors, 0.0%.

## Acceptance criteria

- [ ] Each statistics column sizes to its own content, or scrolls independently.
- [ ] Table names sort naturally.
- [ ] A date is stated once per group, not once per row.
- [ ] Satisfaction Score is defined where it is shown, and reads as "not applicable" rather than 0.0% when nothing was scored.
- [ ] Per Tier and Per Section list every tier and section the plan declares, at zero where nothing landed.
- [ ] Running an assignment with no approved applications says so rather than reporting an empty success.

## Notes

**Why a particular vendor could not be placed** is [map ticket 04](../../../wayfinding/readable-journey/issues/04-when-a-vendor-cannot-be-placed.md) and needs new structure in the solver.
Do not invent a reason string here.
