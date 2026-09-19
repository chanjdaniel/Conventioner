---
id: E11/F01
title: A placement has one writer
type: feature
status: in-progress
blocked_by: []
pr: []
---

## Outcome

One endpoint writes a placement, and a market PUT can no longer overwrite an assignment from a stale
client copy.

## Why now

`update_market()` re-applies `phase`, `is_draft`, `intake_mode`, `application_form`,
`results_published` and `import_mapping` from the stored market, each with a documented single-writer
reason.
`assignment_object` is not in that list, so **any market PUT overwrites an assignment wholesale** -
a live hazard today, with no manual editing involved.
