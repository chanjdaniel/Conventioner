---
id: E04/F01/S02
title: An organizer walks create, setup, import, approve and assign in one session
type: story
status: done
blocked_by: [E04/F01/S01]
pr: [#66]
---

## What to build

One e2e spec in which a single signed-in organizer:

1. creates a market in their organization, through the UI
2. walks the setup wizard: dates, tiers, sections, tables
3. uploads a Google Forms CSV, maps its columns, and imports the rows
4. reviews the imported applications **in the application monitor** and approves them by clicking
   Approve, not by writing a status
5. generates the assignment and sees every approved vendor placed at a table

No API seeding, no `mongosh` writes, no fixture that manufactures an approved application. The
organization and the verified user are the only things seeded, because they precede the journey.

Step 4 is the point of the story. It is the only step in the product with no end-to-end coverage
today, and it is what decides which applications the solver reads.

## Acceptance criteria

- [ ] The spec creates the market through the UI and never over the API
- [ ] The CSV fixture's columns and values match the market plan the spec just built, so the import
      maps cleanly without hand-resolving every value
- [ ] Applications reach `reviewer_approved` only by the organizer clicking Approve in the monitor
- [ ] An `ApplicationMonitorPage` page object wraps that surface, following the existing pattern
- [ ] The assignment is generated from those approvals and every approved vendor appears placed
- [ ] The spec passes repeatedly under a full-suite run, not only in isolation
- [ ] Any bug this uncovers is recorded as a sibling story rather than fixed inside this one,
      unless the fix is what makes the spec pass at all

## Notes

Expect this to find seam bugs: that is why it exists. Reviewing at scale is deliberately out of this
story - bulk-approve's shape is still open in
[wayfinding ticket 08](../../../wayfinding/v0-1-0/issues/08-bulk-approve-shape.md), so keep the
fixture small enough that per-row approval is honest rather than tedious.
