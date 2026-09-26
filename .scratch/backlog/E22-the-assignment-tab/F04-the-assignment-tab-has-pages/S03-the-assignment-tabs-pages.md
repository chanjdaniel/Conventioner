---
id: E22/F04/S03
title: The Assignment tab's pages
type: story
status: done
blocked_by: [E22/F04/S02]
pr: [#83]
---

## What to build

Inside the Assignment tab, a row of pages - **Assignment**, **Result**, **Vendors** - sits under the phase rail and is pinned with the frame.
The row is what makes the tab and its first page, both called Assignment, read as "the tab, and its first page"; the page carrying the market's phase dot is marked, as the tabs are.

The **Assignment** page holds the assignment rules and the run, and no longer the result:

- Assignment Priority, Assignment Options, and the run button.
- **A run lands on Result.**
- Once an assignment exists the button reads **Run again**, with one line saying what it keeps: "Keeps your 4 hand placements; places everyone else again.", or "Places everyone again." when there are none. No confirmation dialog: every hand placement is a pin, and a run re-places only what the solver placed.
- The quick links to Vendors, Tables and Attendance go: those are pages and tabs now.

**Vendors** is today's Vendors screen, as a page of the tab.

## Acceptance criteria

- [x] The page row shows on all three pages and nowhere else, pinned under the rail at any scroll position.
- [x] The Assignment page shows the rules and the run and nothing of the result.
- [x] A successful run lands on Result showing the new assignment; a refused run stays on Assignment with its reason.
- [x] "Run again" and its line appear once an assignment exists, counting the market's hand placements.
- [x] An e2e spec walks: set rules, run, land on Result, return to Assignment, see Run again.
