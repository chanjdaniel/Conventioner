---
id: E26/F02/S04
title: Answers split on known options
type: story
status: done
blocked_by: []
pr: [88]
---


## What to build

A multi-answer cell is split against the question's known options first, so an option containing a comma survives; a date matched twice counts once.

Closes bugs 27 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] "Woven (crochet, knitting, etc)" imports as that option.
- [x] Day answers like "Monday, November 20th, Tuesday, November 21st" import after one match per day, or none when the dates are recognised.
- [x] Matching both halves of a split date no longer refuses the row.
