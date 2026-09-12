---
id: E01/F03/S04
title: Restrict import to the intake phases
type: story
status: in-progress
blocked_by: [E01/F02/S02]
pr: []
---

## What to build

Importing is permitted while a market is taking applications, and refused once review has begun.

Mutating the applicant set under an in-progress review is the hazard: a reviewer working through a list should not have rows appear, change, or return to `open` beneath them. So import is allowed in `applications_open` and `applications_closed`, and refused from `review` onward.

An organizer with a late arrival is not stuck. The state machine already permits returning from `review` to `applications_closed`, so the path is to reopen, import, and move forward again - a deliberate and visible act rather than a silent mutation. The refusal should say so.

## Acceptance criteria

- [ ] Import succeeds in `applications_open` and `applications_closed`
- [ ] Import is refused from `review` onward, including the terminal phases
- [ ] The refusal names the current phase and points at reopening as the way through
- [ ] The refusal is enforced server-side, not only by hiding the UI entry point
- [ ] No new phase transition edges are added
- [ ] Backend tests cover an allowed phase, a refused phase, and the reopen-then-import path
- [ ] An e2e story attempts an import during review, sees the refusal, reopens, and succeeds

## Notes

This deliberately adds no edges to the transition registry. Every precondition for every transition lives in one file and the registry validates itself at import; this is a restriction on an operation, not a new route through the machine.
