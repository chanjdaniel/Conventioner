---
id: E09/F01
title: Colour meets AA
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

Every colour used for text, or as a fill behind text, meets WCAG AA against the surface it sits on -
and a test keeps it that way.

## Why now

Four text colours fail, measured against the surfaces the product actually paints on. The worst is
`--mm-yellow` at **2.15:1**, which nobody had measured. `--mm-grey` at **1.67:1** is the hint,
empty-state and helper colour. `--mm-green` at **2.65:1** is behind the label of every primary
button, including the one a vendor taps outdoors at a market entrance.

The audit and the shape of the fix are settled by
[readable-journey ticket 03](../../../wayfinding/readable-journey/issues/03-contrast-contract-on-tokens.md),
which carries the full table. Read it before starting; the values are already computed.
