---
id: E34/F04/S01
title: The All view
type: story
status: in-progress
blocked_by: [E35/F01/S01]
pr: []
---

## What to build

A toggle on the Applications page between **One by one** and **All**, with the choice and its filters kept in the address.
All lists every application with the answers a reviewer reads first, its status, who gave it, and who holds it.
It filters by status, including needs follow-up, and by "Mine" (follow-ups the viewer owns).
Clicking a row opens the vendor drawer, which during review carries Approve, Reject and Needs follow-up.

## As built

- `MarketApplicationsTab` toggles One by one and All (`?view=all`).
  The All view (`ApplicationsAll.vue`) keeps its status filter (`?status=`) and Mine (`?mine=1`) in the address too.
- A row shows who, the answers a reviewer reads first, the status, who gave it (`verdictGiverLine`), a follow-up's owner, and who holds it open (`heldBy`).
- A row opens the shared vendor drawer (`E35/F01/S01`), whose `actions` slot carries Approve, Reject and Needs follow-up, each written on what was seen (`F03/S01`).
- **Changed from the plan above:** the drawer offers verdicts on the server's one rule, `verdictLockReason`, rather than on a list of review phases.
  That rule allows a verdict until the market can no longer run its assignment, so the `assignment` phase is included.
  The one-by-one review already let an organizer correct a verdict there, and the stored assignment's fingerprints say when the approvals it was made from changed (`E22/F03`).
  A second rule in the browser would disagree with the first.
- The page's "N still to decide" line now counts from either view.

## Acceptance criteria

- [x] The toggle and the filters survive a reload and a shared link.
- [x] Each row shows status, giver and holder.
- [x] A row opens the drawer, and a verdict given there updates the row.
- [x] Once the market runs (past `assignment`), the drawer shows the verdict read-only.
