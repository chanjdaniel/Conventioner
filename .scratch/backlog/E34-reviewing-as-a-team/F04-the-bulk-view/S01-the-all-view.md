---
id: E34/F04/S01
title: The All view
type: story
status: ready
blocked_by: [E35/F01/S01]
pr: []
---

## What to build

A toggle on the Applications page between **One by one** and **All**, with the choice and its filters kept in the address.
All lists every application with the answers a reviewer reads first, its status, who gave it, and who holds it.
It filters by status, including needs follow-up, and by "Mine" (follow-ups the viewer owns).
Clicking a row opens the vendor drawer, which during review carries Approve, Reject and Needs follow-up.

## Acceptance criteria

- [ ] The toggle and the filters survive a reload and a shared link.
- [ ] Each row shows status, giver and holder.
- [ ] A row opens the drawer, and a verdict given there updates the row.
- [ ] Outside the review phases the drawer shows the verdict read-only.
