---
id: E20/F02/S01
title: The import page sizes itself
type: story
status: done
blocked_by: []
pr: []
---

## What to build

The CSV import flow sits centred on the page at the workspace's width, instead of sprawling across an uncapped one.

An organizer on the upload, preview and confirm steps sees a panel in the middle of the page rather than a narrow column pinned to the left.

## Why the steps disagree, and why the shell must not

Three of the four steps are narrow: upload, preview and confirm each render a panel a little over seven hundred pixels wide.
One is wide: mapping columns is a full-width ledger with a rail beside it, and genuinely wants the room.

So a single content width cannot be right - but a single **shell** width must be.
Letting each step size its own shell was considered and rejected: a flow whose page width changes under the organizer as they press Next reads as instability, and the step indicator already says where they are.

## Acceptance criteria

- [x] The view is capped at the workspace's named maximum width and centred on the page.
- [x] The three narrow steps centre their panel within that shell rather than sitting at its left edge.
- [x] The mapping step keeps the width it needs; its ledger and rail are not squeezed.
- [x] **The shell does not change width between steps.** Walk all four and confirm.
- [x] The view obeys the project's sizing model: one of the two named widths, and the page scrolls rather than the view capping its own height.
- [x] The stale comment claiming this wizard "only ever runs in applications_open" is corrected - the import phases are two, and a later story in this epic depends on that being understood.
- [x] Verified by screenshot at 1920x1080 on all four steps, before and after.
  Before: shell 1920 wide, left edge 0, on every step - a 720px panel pinned left with 1,200px beside it.
  After: shell 1440 (`--workspace-max`), left edge 240, identical on all four.
  Pinned by `csv-import.spec.ts`, which walks the four and asserts one width, centred, with nothing boxed.
- [x] `npm run lint:css` passes.

## Do not

Do not make this a modal, in whole or in part.
That would reverse a decision recorded in the source as the winner of a three-variant prototype, and nothing found since is evidence against it.
