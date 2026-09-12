---
id: E01/F02/S03
title: Map a checkbox grid to one target
type: story
status: in-progress
blocked_by: [E01/F02/S02]
pr: []
---

## What to build

One question answered across several CSV columns maps to a single target.

A Google Forms checkbox grid exports one column per option: `Which days can you attend? [Saturday July 4]`, `... [Sunday July 5]`, `... [Monday July 6]`. The same question asked as a single checkbox question exports as **one** column with comma-separated values. Both shapes are common, both mean the same thing, and the previous story handles only the second.

The mapping screen recognises columns sharing a question stem, presents them as a group with a single control that maps all of them at once, and states plainly which shape it is reading - "3 columns, one per option" against "1 column, values split on commas" - so the organizer can see it guessed right.

Applies to availability, tier preference, and section ranking alike.

## Acceptance criteria

- [ ] Columns sharing a question stem are detected and presented as one group
- [ ] A group maps to a target in one action, not column by column
- [ ] The screen states which export shape it read for each multi-value target
- [ ] A detected group can be broken apart when the detection is wrong
- [ ] Both shapes produce identical stored answers for the same underlying responses
- [ ] Section ranking recovers a meaningful order from whichever shape it is given
- [ ] Backend tests cover both shapes producing the same document
- [ ] An e2e story imports a grid-shaped CSV and asserts the persisted answers

## Notes

This is the case a naive one-column-to-one-target design gets wrong, which is why all three prototype variants were judged partly on how they handled it. The winning treatment came from the target-board variant: label the shape explicitly rather than inferring silently.

Ranking order from a checkbox grid is genuinely ambiguous - a grid records which options were chosen, not their order. Decide and document what order the import produces rather than leaving it to column position by accident.
