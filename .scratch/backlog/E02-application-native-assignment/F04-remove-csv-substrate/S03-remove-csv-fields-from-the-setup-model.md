---
id: E02/F04/S03
title: Remove the CSV-derived fields from the setup model
type: story
status: ready
blocked_by: [E02/F04/S02]
pr: []
---

## What to build

A market's setup no longer carries column names, column values, column-inclusion flags, or any column index.

The assignment options lose their four column-index fields, which named the email, table-choice, table-share and max-days columns.
The priority rule's column index is already gone from F02; this story removes whatever remained around it.

## Acceptance criteria

- [ ] Column names, column values, and column-inclusion flags are gone from the market setup model
- [ ] All four column-index fields are gone from the assignment options
- [ ] No `col_name_idx` or `col_names` reference remains in the back end outside the market-dates field, which S04 owns
- [ ] `docs/schema.d.ts` is regenerated from the contract models, not hand-edited, and its generation test passes
- [ ] Existing market documents carrying these keys still load without error
- [ ] Backend tests referencing the removed fields are updated or deleted
- [ ] The full suite is green

## Notes

The schema file is generated.
Editing it by hand passes review and fails its generation test.
