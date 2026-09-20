---
id: E16/F04/S03
title: The chip primitive
type: story
status: done
blocked_by: [E16/F02, E16/F03]
pr: [77]
---

## What to build

One `.chip` for status and metadata labels. Six treatments exist today for what is one idea:

| Chip | Screen | Shape | Fill | Text |
| --- | --- | --- | --- | --- |
| Market Days | Markets | pill r20 | solid `#0C875E` | white |
| Applications Open | Markets | pill r20 | solid `#3472D8` | white |
| Open | Triage card | rect r4 | solid `#1B7AC5` | white |
| Owner | Organizations | rect r4 | tint `#E3F2FD` | `--mm-text-link` |
| Unassigned | Vendors | rect | amber tint | amber |
| FULL TABLE | Tables | pill, uppercase | solid green | white |

`Applications Open` and `Open` are **the same state seen from two screens**, in two blues and two shapes. `E16/F01/S02` has already collapsed the colours onto `--mm-blue`; this story collapses the shapes.

One shape, one size, and a small set of tones. Decide tint-with-coloured-text versus solid-with-white-text once - the walk's judgement is that **tint reads better at this density**, because a list of six solid pills competes with the content it labels, but that is the call this story makes explicit rather than inherits.

## Acceptance criteria

- [x] One chip shape and one size across the product.
- [x] The same state renders identically wherever it appears.
- [x] Every tone passes the contrast sweep from `E16/F01/S05`.
- [x] Uppercase is either the rule for chips or is used nowhere; `FULL TABLE` is currently the only one.

## Notes

Blocked on `F02` and `F03`.
