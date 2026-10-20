---
id: E34/F04/S02
title: A verdict on a selection
type: story
status: ready
blocked_by: [E34/F04/S01, E34/F03/S02]
pr: []
---

## What to build

In the All view, rows have checkboxes, and a ticked selection takes Approve, Reject or Needs follow-up.
A confirmation names the verdict and the count before anything is written.
Each application in the selection is written as `F03/S01` writes one: an application another reviewer holds cannot be ticked, and one changed since the list loaded is skipped; the result says how many were written and how many skipped, and why.
There is no action on "everything matching the filter".

## Acceptance criteria

- [ ] Ticking rows and approving shows a confirmation with the count, then writes each with its giver.
- [ ] Held applications cannot be ticked; changed ones are skipped and counted.
- [ ] No control acts on unticked rows.
