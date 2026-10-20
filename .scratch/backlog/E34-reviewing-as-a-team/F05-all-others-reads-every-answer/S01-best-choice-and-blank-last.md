---
id: E34/F05/S01
title: Best choice, and blank last
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

Under an arranged rule, a multi-select answer scores the best position among its choices, where an unplaced choice takes the position of "All others" (or last, without it).
A blank answer scores behind every placed position, "All others" included.
Write it against the solver's behavioural suite, with the clubs rule as the example: ordering "All others", then "I am not part of any of these clubs".
Check whether the scoring change needs the assignment fingerprints to mark stored runs out of date.

## Acceptance criteria

- [ ] An applicant who ticked "Club B, Club A" under "Club A, All others, None" scores as Club A.
- [ ] On the clubs rule, an applicant who left it blank sorts behind "I am not part of any of these clubs".
- [ ] The existing "All others" tests still pass.
