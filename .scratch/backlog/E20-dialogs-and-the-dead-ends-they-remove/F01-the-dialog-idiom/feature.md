---
id: E20/F01
title: The dialog idiom
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

Every dialog in the product is the same thing: a form that does one small job, submits on Enter, and stays open until the organizer closes it.

## Why now

Four of the fourth walk's findings were about dialogs and they were one problem four times.

There is partial shared scaffolding - the page is held inert behind a modal through a shared helper - but **no shared dialog component**: each of the five overlays hand-rolls its own scrim, window and close button.
And **not one of them contains a form element**, which is why Enter does nothing in four dialogs while six other views each solved it differently.

Settled in [ticket 08](../../../wayfinding/the-order-of-the-work/issues/08-what-a-dialog-is-in-this-product.md).

## The four rules

1. **A dialog is a native form whose confirm button submits.**
   Six views already get Enter free this way, and it makes the two requirements automatic rather than remembered: submission runs the same handler as the button, so it inherits that handler's guard; and a disabled submit makes Enter inert with no extra code.
2. **Closing never means saved, and saving never closes.**
3. **A field looks like a field**, through the shared control primitive.
4. **Errors sit in the layout**, beneath the control they describe.

## Stories

- `S01` - a dialog shell, proved by the create-market dialog.
- `S02` - manage organization stays open.
- `S03` - the remaining dialogs adopt the idiom.
