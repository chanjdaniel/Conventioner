---
id: E31/F02/S01
title: The market read serves each move's verdict
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

`GET /markets/:id` serves, for each transition available from the current phase, whether it would succeed and if not its blockers, in the existing `PreconditionResult` shape, judged by the same `guards.py` the transition endpoint runs.
The rail renders the forward step and every menu item from it: a move that would be refused is disabled with its first blocker (and "Reopen for Editing" with applications present says why), never enabled and refused after the click.

## Acceptance criteria

- [ ] The served verdicts and the transition endpoint agree for every edge (a test walks `VALID_TRANSITIONS`).
- [ ] An empty draft's "Open Applications" and a not-yet-run market's "Publish Market" render disabled with their blocker.
- [ ] `BlockerPanel.vue` stays generic over the wire shape.
