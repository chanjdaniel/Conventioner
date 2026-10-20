---
id: E33/F02/S01
title: The proposal marks nothing required
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The CSV proposal stops inferring requiredness: every proposed custom question is not required, and the organizer can turn it on.
The essential questions keep their own rules.
Hold the change against the hand-written answer key on the five anonymised exports, updating the key's requiredness column.

## Acceptance criteria

- [ ] A proposal from any of the five exports marks no custom question required.
- [ ] Importing the real November 2026 export after starting from it skips no row for a blank answer to a custom question.
- [ ] A question the organizer marks required is still enforced online.
