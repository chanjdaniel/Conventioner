---
id: E20/F02
title: The import page sizes itself
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

The CSV import flow sits in the middle of the page at a width the rest of the product already uses.

## Why now

The walk reported a lot of white space and offered two remedies: make it a modal, or centre it.
The second is the answer.

Making it a modal would reverse a decision the source records as the winner of a three-variant prototype - a dialog was rejected because mapping a dozen columns against a target list is too dense for one - and nothing this walk found is evidence against that.

The white space was never a disagreement with that decision.
**The view simply never joined the project's sizing model**: it declares padding and no maximum width at all, while every other screen picks one of the two named widths.

Settled in [ticket 06](../../../wayfinding/the-order-of-the-work/issues/06-what-shape-is-the-import-flow.md).

## Stories

- `S01` - the import page sizes itself.
