---
id: E34/F04/S02
title: A verdict on a selection
type: story
status: in-progress
blocked_by: [E34/F04/S01, E34/F03/S02]
pr: []
---

## What to build

In the All view, rows have checkboxes, and a ticked selection takes Approve, Reject or Needs follow-up.
A confirmation names the verdict and the count before anything is written.
Each application in the selection is written as `F03/S01` writes one: an application another reviewer holds cannot be ticked, and one changed since the list loaded is skipped; the result says how many were written and how many skipped, and why.
There is no action on "everything matching the filter".

## As built

- `POST /markets/:id/applications/verdicts` (EDITOR) takes the ticked applications, each with what was `seen`, and writes each as one verdict is (`review_selection`).
  One another reviewer holds open is not written; one changed since is skipped with who changed it; one already at the status is skipped as "Already approved." rather than changing hands.
  The answer lists what was written and, for each skipped, why.
- In the All view a row's tick is disabled, with the holder named, while someone else has it open; a filter that hides a ticked row unticks it.
- The selection's verdicts open a confirmation naming the verdict and the count ("Approve 2 applications?"); a follow-up on a selection is owned by the reviewer.
- Every verdict from the All view is followed by the store re-reading the market, so the rail's count moves.

## Acceptance criteria

- [x] Ticking rows and approving shows a confirmation with the count, then writes each with its giver.
- [x] Held applications cannot be ticked; changed ones are skipped and counted.
- [x] No control acts on unticked rows.
