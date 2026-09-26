---
id: E22/F03/S01
title: A run records what it was made from, and the market says when that has changed
type: story
status: done
blocked_by: []
pr: [#83]
---

## What to build

Each assignment run stores, beside the assignment, a fingerprint of each of the three things the solver read:

- **the rules**: the priority, the max assignments per vendor, the max half-table proportion;
- **the plan**: the dates, tiers, locations, sections and their counts;
- **the approved applications**: which applications were approved, and their answers.

The single-market read serves `assignmentOutOfDate`: which of the three groups now differ from what the run recorded, or none.
It is computed on read and never stored, and no request body can write it - the same shape as the form lock (AGENTS.md, **One Market, From the Server**).

Hand placements are not an input: they are edits to the result, so placing, freeing or swapping never makes it out of date.
A market assigned before this ships has no fingerprints, and is served as **not known to be out of date** - never as out of date, because a notice on every existing market would teach organizers to ignore it.

Each group's fingerprint is computed in one place, read by both the run and the read, so the two can never disagree about what "the same" means.

## Acceptance criteria

- [x] After a run, the market reads as up to date.
- [x] Changing a rule, the plan, or which applications are approved (or an approved application's answers) makes it read as out of date, naming exactly the groups that changed.
- [x] Changing a thing back to what the run saw makes it up to date again.
- [x] Placing, freeing and swapping do not make it out of date.
- [x] A market with an assignment and no fingerprints reads as not out of date.
- [x] Running again records fresh fingerprints and clears it.
- [x] Pinned by pytest at the run and at the market read.
