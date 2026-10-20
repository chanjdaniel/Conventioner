---
id: E36/F01/S01
title: Verdicts lock on entering assignment
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

Once a market is in assignment or later, no verdict can be given or changed: approve, reject, needs follow-up, one at a time or on a selection.
The rule is the automatic rejections' own, "can the market still reach review", derived from the transition table rather than listed, so the two lock together and cannot drift (decisions 1-2).
The Applications page in assignment reads as the review's record: every verdict and who gave it, and no control to change one, with a line saying the review closed when assignment began and that seats are changed by hand.
There is no move from assignment back to review, and none is added.

## Acceptance criteria

- [ ] In assignment, market days and archived, a verdict write (single or bulk) is refused with a reason naming the phase; in review and earlier it is accepted as today.
- [ ] Needs follow-up is refused on the same rule.
- [ ] The market read serves the lock as a reason the page mirrors, and the page draws no verdict control while it is set.
- [ ] The verdict lock and the automatic-rejection lock are one derived rule, with a test that they agree in every phase.
- [ ] E2E specs that give a verdict in assignment give it before entering it; one spec pins the refusal in assignment through the UI.
- [ ] AGENTS.md says when verdicts settle.
