---
id: E12/F01/S01
title: Four reasons, computed on read
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

For a `(vendor, date)` pair with no placement, an enum naming why, derived from the application, the
assignment and the plan at the moment it is asked:

- **Not available** - they did not tick that date.
- **No table of a tier they accept** - the plan has no section at any tier they named.
- **Taken** - such tables exist and none is free.
- **Free** - such tables exist and one is, so they could be placed now.

An enum, not a string: the wording belongs in the front end and must be changeable without a
migration.

Cover **partially placed** vendors, not only those with `num_assignments == 0`.
A vendor who asked for two dates and got one has a gap the product currently renders as an em dash.

**Do not touch the solver.**
`assign()`, `best_table_for` and `is_valid_vendor` stay as they are, and
`back-end/tests/test_assignment_behaviour.py` should not need a line changed.
The derivation belongs beside the statistics, not inside the run.

## Acceptance criteria

- [ ] Each of the four reasons is produced for a case that warrants it, under unit test.
- [ ] A vendor placed on one date and not another gets a reason for the second.
- [ ] Unplacing a vendor by hand flips a sibling's reason from **taken** to **free**, with no
      re-run. This is the case that justifies computing rather than recording.
- [ ] No diff in `assignment/assignment.py`.
