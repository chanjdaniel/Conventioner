---
id: E34/F05/S01
title: Best choice, and blank last
type: story
status: done
blocked_by: []
pr: [#111]
---

## What to build

Under an arranged rule, a multi-select answer scores the best position among its choices, where an unplaced choice takes the position of "All others" (or last, without it).
A blank answer scores behind every placed position, "All others" included.
Write it against the solver's behavioural suite, with the clubs rule as the example: ordering "All others", then "I am not part of any of these clubs".
Check whether the scoring change needs the assignment fingerprints to mark stored runs out of date.

## As built

- `_arranged_score` (`assignment/assignment.py`) scores the best position among a multi-select's choices.
  An unplaced choice takes "All others"' place, or last without it, and a blank answer sorts one place behind everything, "All others" and unplaced answers included.
- The old test that pinned first-choice scoring is replaced; each new test is written against the tie-breaks, so it fails on the old scoring.
- The rule editor's hint says how several answers and a blank sort.
- Fingerprints: not changed.
  They record a run's inputs (rules, plan, approved applications), not how the solver scores them, so no input moved.
  A stored run is of a market past the November 2026 window by the time this ships, and running it again is the organizer's choice.

## Acceptance criteria

- [x] An applicant who ticked "Club B, Club A" under "Club A, All others, None" scores as Club A.
- [x] On the clubs rule, an applicant who left it blank sorts behind "I am not part of any of these clubs".
- [x] The existing "All others" tests still pass.
