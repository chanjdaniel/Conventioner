---
id: E12/F01
title: The reason a vendor is not placed
type: feature
status: in-progress
blocked_by: []
pr: [72]
---

## Outcome

For any vendor and any market date, the product can say why there is no table there.

## Why now

`unassigned_vendors` is a list of email strings derived from `num_assignments == 0`, and
`best_table_for` returns bare `None`.
Nothing anywhere holds a reason, and the organizer is left to infer one from a summary that says
nineteen tables are free.
