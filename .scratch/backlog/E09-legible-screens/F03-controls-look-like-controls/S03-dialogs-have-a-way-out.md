---
id: E09/F03/S03
title: Dialogs have a primary action that looks like one, and a way out
type: story
status: done
blocked_by: []
pr: [69]
---

## What to build

**No overlay in the product closes on Escape.** Verified on the vendor detail panel and on Manage organization; the create-market and setup-path dialogs are the same pattern.

**Two have no visible close control at all.**
Manage organization has no X and no Cancel, and the last element in its scrolling body is a red "Delete organization".
Clicking the scrim does close it, but nothing says so.
The setup-path chooser is blocking with no way to dismiss and look at the market first.

**The create-market dialog's primary action is bare text.**
"Submit" computes to `background: transparent`, `border: 0px none`, `padding: 0px` - no affordance, no hit target, and visually identical enabled and disabled.
It also has no Cancel.

## Acceptance criteria

- [ ] Escape closes every overlay in the product.
- [ ] Every overlay has a visible close or cancel control.
- [ ] "Submit" on the create-market dialog is a button that looks like the product's other primary buttons.
- [ ] No dialog ends with a destructive action as its last and only visible control.
- [ ] Field labelling within the create-market dialog is consistent: today "ORGANIZATION" has a label and the market name is placeholder-only.
