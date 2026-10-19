---
id: E34/F01/S01
title: A verdict records its giver, at EDITOR
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

Approving, rejecting (and, from `F02`, marking for follow-up) stores who gave the verdict and when, beside the status.
The card and the vendor drawer show it.
A verdict an automatic rule gave (`E33/F03`) names the rule as its giver.
The verdict endpoints move from ADMIN to EDITOR, and the market read's per-person reasons move verdicts from the admin-actions reason to the change reason, so a screen draws verdict controls for an EDITOR; phase moves, publishing and importing stay ADMIN.
Applications stored before this have no giver and show none.

## Acceptance criteria

- [ ] A verdict stores and shows its giver and time.
- [ ] An EDITOR can give verdicts and sees the controls; a VIEWER cannot and does not.
- [ ] An EDITOR still cannot move the market's phase.
- [ ] An application with no recorded giver renders without one.
