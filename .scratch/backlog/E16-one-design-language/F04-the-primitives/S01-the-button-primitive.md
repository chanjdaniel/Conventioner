---
id: E16/F04/S01
title: The button primitive
type: story
status: blocked
blocked_by: [E16/F02, E16/F03]
pr: []
---

## What to build

One `.btn` owning height, padding, radius, type, focus ring and disabled state, with three intents.

What it has to replace, measured:

| | Today |
| --- | --- |
| Heights | 25, 30, 32, 34, 35, 36, 38, 45, 54, 60px |
| Typefaces | Outfit, Inter, Arial, Merge One |
| Weights | 400 and 500 on the same visual button |
| Radii | 0, 4, 5, 6, 10px |
| Disabled | four treatments, one at 1.74:1 |

Three intents and nothing more:

- **primary** - `--mm-green`. One per screen region. The check-in page currently has its primary on the spent action; `E15/F02/S04` fixes that case, this story makes it hard to repeat.
- **secondary** - outline. The `Manage` button is this on Markets and solid-dark on Organizations; secondary wins, because a row's action should not out-weigh the row.
- **destructive** - `--mm-red`. Not a peer of an additive action: `Delete market` is currently the exact visual weight of `Add user`.

One disabled state, reaching 4.5:1 or not relying on text contrast at all.

A visible focus ring is part of this story, not a later one. The product has 65 keyboard-reachable controls and no consistent focus treatment.

## Acceptance criteria

- [ ] One height for a standard button and one for a compact one; no third.
- [ ] Every button in the product can be expressed as `.btn` plus one intent, with no local overrides. Where it cannot, the gap is recorded rather than patched locally.
- [ ] The disabled state passes the contrast sweep from `E16/F01/S05`.
- [ ] Every intent has a visible focus ring that passes contrast against both its own fill and the page.
- [ ] No migration in this story; the primitive ships with a rendered example page or story book entry, so the slices have something to check against.

## Notes

Blocked on `F02` for the tokens and `F03` for the layout it must fit.
