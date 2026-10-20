---
id: E36/F02/S02
title: The place dialog offers every applicant, warned
type: story
status: in-progress
blocked_by: [E36/F02/S01]
pr: []
---

## What to build

The place dialog lists every applicant, not only approved ones (decisions 3-4).
Beside "fits as they answered" and "would override", a third group, "Not approved", lists the rejected applicants.
Picking one shows, before the change, "Not approved" with who rejected them and when, or that a rule rejected them and the rule's reason, alongside the usual tier, date and table-size warnings.
It never blocks; it is an editor's action like any placement, recorded in the placement trail.
The seat is stored as a pin, so a later run seats them first, instead of keeping the pin as an orphan, and the orphaned-pin guard does not count it.

## As built

- The tables read serves every applicant: the run's vendors, then `outside_solver_vendors` translated leniently, each with `notApproved` (status and giver) and `inTheRun`.
- A run seats a pin for someone outside it as `held` (`held_vendors_for`): their seat is occupied and nobody else is put in it. Before, the seat was left free for a second vendor.

## Acceptance criteria

- [x] The dialog's "Not approved" group lists every rejected applicant, and none appears in the other two groups.
- [x] Picking a rejected applicant warns with the giver and date, or the rule's reason, plus any tier, date or size override; the place still goes through.
- [x] The seat is a pin: a re-run keeps them in it, and going live is not blocked by it.
- [x] A viewer sees no place control, as today.
- [x] One E2E spec places a rejected applicant through the dialog, reads the warning, re-runs, and finds them still seated.
