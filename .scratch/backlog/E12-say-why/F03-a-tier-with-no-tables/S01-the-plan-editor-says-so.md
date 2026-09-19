---
id: E12/F03/S01
title: The plan editor says a tier has no tables
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

In the plan editor, a tier with no section at that tier is marked as having no tables.
A warning, not an error: an organizer mid-build has one constantly, and a tier nobody has asked for
is harmless.

## Acceptance criteria

- [ ] Adding a tier and no section for it marks that tier.
- [ ] Adding a section at that tier clears the mark, live.
- [ ] The mark is legible per `E09/F01/S01`, and does not read as a failure.
