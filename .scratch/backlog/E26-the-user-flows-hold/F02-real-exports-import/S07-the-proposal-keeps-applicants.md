---
id: E26/F02/S07
title: The proposal keeps applicants and whole labels
type: story
status: done
blocked_by: []
pr: [88]
---


## What to build

On a question with left-out options, the proposal offers one click to keep them all and a way to see every answer (one-offs included) and tick which to keep, and says how many applicants would be left with no answer on a required question.
Headings are split into label and help text only at a sentence end.

Closes bugs 4, 41 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] "Keep all" keeps every answer of that question.
- [x] "Show all answers" lists the one-off answers with checkboxes.
- [x] A required question says how many applicants its left-out options would drop.
- [x] No proposed label ends mid-sentence on the five anonymised exports.
