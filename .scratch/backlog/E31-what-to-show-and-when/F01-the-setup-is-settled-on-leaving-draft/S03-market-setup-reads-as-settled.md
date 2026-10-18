---
id: E31/F01/S03
title: Market Setup reads as settled
type: story
status: in-progress
blocked_by: [E31/F01/S02]
pr: []
---

## What to build

After draft, Market Setup is read-only with one line: "Settled when applications opened" (on the CSV path, "when you started collecting"), and how to change it while that is still possible.
No input on the page looks editable, and the floorplan flow opens read-only.

## Acceptance criteria

- [x] From `applications_open` on, on both paths, no Market Setup control accepts input, and the line says why.
- [x] While no application exists, the line says the market can go back to draft.
- [x] `every-control-is-named.spec.ts` and the contrast sweep still pass on the read-only page.
