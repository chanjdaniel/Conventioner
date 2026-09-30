---
id: E26/F02/S06
title: Value decisions are visible and changeable
type: story
status: proposed
blocked_by: []
pr: []
---


## What to build

Every value decision in play on the mapping step, whether restored from the last import or the proposal or made on this visit, is listed in the row it belongs to and can be changed; going Back keeps them visible.

Closes bugs 28 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [ ] A market started from a CSV shows its saved decisions on the first import's mapping step.
- [ ] Changing a restored "ignore" to a real option takes effect in the preview.
- [ ] A value matched, previewed and then revisited with Back is still listed and changeable.
