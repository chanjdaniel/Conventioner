---
id: E20/F01/S03
title: The remaining dialogs adopt the idiom
type: story
status: ready
blocked_by: [E20/F01/S01]
pr: []
---

## What to build

Every remaining dialog in the product becomes the same thing the create-market dialog became, and Enter means the same thing everywhere.

An organizer who has learned one dialog has learned all of them.

## What adopts the shell

The manage-market dialog, the placement dialog, the load-market dialog, and the market-archive confirmation.

## What converges on one Enter pattern

Four surfaces have **no** Enter handling at all and gain it: the manage-market dialog, the placement dialog, the import wizard, and - through `S02` - the manage-organization dialog.

Six more already work but disagree with each other, and are brought onto one pattern: two views use key-down, two use key-up, and the three floorplan panels use key-down with two of them preventing the default.
**The floorplan panels are included.** They are a surface MVP does not reach, but leaving three files on a second pattern means the next author copies whichever they open first, which is the whole reason this is a policy rather than a fix.

## The dialog that must be opened and looked at

The market-archive confirmation is **the one irreversible action in the product**, and it has been invisible before: a colour token was referenced in seven rules and defined nowhere, which rendered its button as white text on a white dialog with no border.
A sweep that does not open this dialog will not see it.
Open it.

## Acceptance criteria

- [ ] The manage-market, placement, load-market and archive-confirmation dialogs are rebuilt on the shell.
- [ ] Enter submits in every dialog that has a confirm action, through the same handler the button uses, and does nothing when that button is disabled.
- [ ] The six hand-rolled Enter handlers are converged onto the single pattern the shell establishes, **including the three floorplan panels**.
- [ ] Fields in these dialogs reach for the shared control primitive; errors sit in flow.
- [ ] The archive confirmation is **opened and screenshotted** in the PR, with its button legible and its destructive intent clear.
- [ ] Each dialog's existing behaviour is preserved - the placement dialog's swap, the manage-market dialog's role changes, the load-market dialog's selection.
- [ ] Every e2e spec that drives these dialogs passes, updated only where the interaction genuinely changed.
- [ ] `npm run format:check`, `npm run lint:css` and the type check pass.

## Out of scope, deliberately

What Enter means in a multi-line textarea, where it types a newline and must not submit, and in a row-based editor where it might reasonably add a row.
Neither is a dialog; both are recorded as open on the wayfinder map.
