---
id: E32/F02/S02
title: A late export comes in from the menu
type: story
status: ready
blocked_by: [E32/F02/S01]
pr: []
---

## What to build

Responses that arrive after review has begun are brought in with **"Import more responses"** in the rail's menu, never as the main button.
It moves the market from review back to importing in one move and lands on the import; every verdict already given is kept, and the re-import's own matching (new, updated, unchanged) applies.

## Already built

`S01` built the move itself: from review, the rail's menu offers "Import more responses", one move back to importing through the closed phase, landing on the import. What remains is to prove what it does to the verdicts and a later export.

## Acceptance criteria

- [x] In review, the rail's menu offers "Import more responses", and the main button does not.
- [ ] It lands on the import with the market back in importing, and the existing verdicts are unchanged.
- [ ] Importing a later export adds only its new rows, which arrive undecided.
