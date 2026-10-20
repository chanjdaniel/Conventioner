---
id: E36/F02/S02
title: The place dialog offers every applicant, warned
type: story
status: ready
blocked_by: [E36/F02/S01]
pr: []
---

## What to build

The place dialog lists every applicant, not only approved ones (decisions 3-4).
Beside "fits as they answered" and "would override", a third group, "Not approved", lists the rejected applicants.
Picking one shows, before the change, "Not approved" with who rejected them and when, or that a rule rejected them and the rule's reason, alongside the usual tier, date and table-size warnings.
It never blocks; it is an editor's action like any placement, recorded in the placement trail.
The seat is stored as a pin, so a later run seats them first, instead of keeping the pin as an orphan, and the orphaned-pin guard does not count it.

## Acceptance criteria

- [ ] The dialog's "Not approved" group lists every rejected applicant, and none appears in the other two groups.
- [ ] Picking a rejected applicant warns with the giver and date, or the rule's reason, plus any tier, date or size override; the place still goes through.
- [ ] The seat is a pin: a re-run keeps them in it, and going live is not blocked by it.
- [ ] A viewer sees no place control, as today.
- [ ] One E2E spec places a rejected applicant through the dialog, reads the warning, re-runs, and finds them still seated.
