---
id: E08/F02
title: Copy and navigation tell the truth
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

No control points somewhere it does not go, and no hint refers to something that is not on screen.

## Why now

First-contact damage, all of it cheap. From `.lavish/mvp-findings.html`:

- **Four of six sidebar links point at `/vendors`** - "View Tables", "Discord Tools" and "View Change Log" all land on the same wrong page. Vestigial navigation from an earlier product, on every screen.
- "Set both assignment options above to run the assignment" is shown on Market Setup steps 1 and 2, where no assignment options exist. They are on step 3.
- The market's name appears nowhere on its own setup page; the page is titled "Settings".
- The Form Builder's Save is permanently disabled on an essential-only form, saying "Add at least one field to save this form" - but the back end correctly accepts an essential-only form and the phase transition succeeds. `front-end/src/utils/applicationForm.ts:23`.
- The import rail shows green "All required questions are mapped." directly above red "Still unmapped:" with an empty list.
- The import preview leaves the source column blank for grid-mapped targets, while every other row names its column - reading as "not mapped" at the moment you confirm 232 writes.
- The step called "Preview" shows only the mapping recap, never a sample row.
- Unmatched-value resolution offers raw contract values `full` / `half` / `either` to the organizer.
- Section Setup: name inputs about 92px wide clip their content, the location dropdown truncates to "Nest Ballrc", column headers do not align with their fields, and the delete control appears only on the last row.
- Market Setup step 3: the "Assign" and "Next" buttons overlap; the priority selects truncate to "When the application" and "Earliest".
- The setup-path modal shows two grey circles where icons should be, and offers "Floorplan AI - Try Beta" prominently although the floorplan is out of scope and table type is stubbed to one type.
- The vendors table shows "Cost" as an em-dash for all 199 vendors, and identifies vendors by email with no business name.
- First-run dashboard says "Open a market to get started" with no market and no create action, and gives "Sign out" equal weight to the two real destinations.
- Import step 1 is a raw unstyled file input with no drag-and-drop and no indication of which market is being imported into.

Split into stories as the work is picked up; they are listed together because they were found together.
