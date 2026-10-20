---
id: E34/F01/S01
title: A verdict records its giver, at EDITOR
type: story
status: done
blocked_by: []
pr: [#110]
---

## What to build

Approving, rejecting (and, from `F02`, marking for follow-up) stores who gave the verdict and when, beside the status.
The card and the vendor drawer show it.
A verdict an automatic rule gave (`E33/F03`) names the rule as its giver.
The verdict endpoints move from ADMIN to EDITOR, and the market read's per-person reasons move verdicts from the admin-actions reason to the change reason, so a screen draws verdict controls for an EDITOR; phase moves, publishing and importing stay ADMIN.
Applications stored before this have no giver and show none.

## As built

- Built on `feat/the-form-tab-in-steps`, ahead of the rest of E34, because `E33/F03/S02` records an automatic rejection with its giver.
- An application stores `verdict_by` (`VerdictGiver`: a person by id and address, or a rule) and `verdict_at`.
  Both are written in the same update as the status by `api.applications.update_application_status`; a status written with no giver clears both.
- `PUT /markets/:id/applications/:id/review` asks EDITOR, while the market can still run its assignment (`verdict_refusal` in `api/markets.py`).
  The market read serves that rule as `verdictLockReason`, which every review screen draws its verdicts on; Publish Results stays on `adminActionsReason`.
- The card, the decided list and the Vendors drawer say "Approved by alex@market.test, Oct 19, 2026 at 5:04 PM" (`utils/verdicts.ts`).
- `withUser` moved from the access-control spec to `e2e/helpers/withUser.ts`.

## Acceptance criteria

- [x] A verdict stores and shows its giver and time.
- [x] An EDITOR can give verdicts and sees the controls; a VIEWER cannot and does not.
- [x] An EDITOR still cannot move the market's phase.
- [x] An application with no recorded giver renders without one.
