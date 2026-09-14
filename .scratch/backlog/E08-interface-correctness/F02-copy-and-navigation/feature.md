---
id: E08/F02
title: Copy and navigation tell the truth
type: feature
status: in-progress
blocked_by: []
pr: [04215fc0]
---

## Outcome

No control points somewhere it does not go, and no hint refers to something that is not on screen.

## Why now

First-contact damage, all of it cheap, all of it found by walking the journey on 2026-09-14
(`.lavish/mvp-findings.html`).

## Done

- **Four of six sidebar links pointed at `/vendors`.**
  "View Tables", "Discord Tools" and "View Change Log" all landed on the vendors page, and "Manage
  Tables" opened `/init`, the new-or-existing market chooser.
  The two with no page at all are gone rather than re-pointed; Organizations was added because it is
  a real page that was reachable only from the dashboard.
- "Set both assignment options above to run the assignment" no longer appears on wizard pages that
  have no assignment options.
- The Assign and Next buttons no longer overlap on the last page.
  Next was `v-else` on the assignment-error banner, so it rendered beside Assign and vanished
  whenever an assignment failed.
- The market's name is the settings page title, instead of "Settings" on every market.
- The form builder no longer tells an organizer their essential-only form cannot be saved.
  The back end accepts one and the phase transition succeeds, so the hint contradicted the product.
- The import rail no longer shows a red "Still unmapped:" with an empty list directly under the
  green "All required questions are mapped."
- The import preview names the columns behind a grid-mapped target instead of showing a blank at the
  moment the organizer confirms 232 writes.
- Unmatched table-choice values offer "A whole table to myself" rather than the contract's `full`.

## Still to do

Each is a separate story when picked up; they are listed together because they were found together.

- The step called "Preview" shows only the mapping recap, never a sample row.
- Section Setup: name inputs about 92px wide clip their content, the location dropdown truncates to
  "Nest Ballrc", column headers do not align with their fields, and the delete control appears only
  on the last row.
- Market Setup step 3: the priority selects truncate to "When the application" and "Earliest".
- The setup-path modal shows two grey circles where icons should be, and offers "Floorplan AI - Try
  Beta" prominently although the floorplan is out of scope and table type is stubbed to one type.
- The vendors table shows "Cost" as an em-dash for all 199 vendors, and identifies vendors by email
  with no business name.
  See the map's **Not yet specified** on price per tier before building this one.
- First-run dashboard says "Open a market to get started" with no market and no create action, and
  gives "Sign out" equal weight to the two real destinations.
- Import step 1 is a raw unstyled file input with no drag-and-drop and no indication of which market
  is being imported into.
