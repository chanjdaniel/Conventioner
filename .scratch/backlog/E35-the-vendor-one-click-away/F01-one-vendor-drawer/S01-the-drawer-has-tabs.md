---
id: E35/F01/S01
title: The drawer has tabs
type: story
status: done
blocked_by: []
pr: [#111]
---

## What to build

The vendor drawer becomes one component any screen can open for a vendor of the market.
Its notes are pinned at the top, and below them three tabs: **Application** (the submission, as today), **Assignments** (their placements, with Change placement), and **History** (their placement history).
The tab is kept in the address while the drawer is open.

## As built

- Built on `feat/reviewing-as-a-team`, ahead of the rest of E35, because `E34/F04/S01` opens the drawer.
- `components/VendorDrawer.vue` is the drawer, with its scrim, inert behind it and Escape.
  Notes are pinned at the top, then a tab list (Application, Assignments, History) that moves with the arrow keys.
- `utils/vendorDetails.ts` (`useVendorDetails`) loads a market's vendors once, for the Vendors list and the drawer alike: every application, decided or not, with its seats, reasons and overrides.
  The list narrows to the vendors the run places.
- `utils/vendorDrawer.ts` keeps the open vendor and tab in the address (`?vendor=...&vendorTab=assignments`), and owns the tab names.
- The drawer opens on Application wherever it opens, "Unassigned only" included.

## Acceptance criteria

- [x] The Vendors page opens the drawer as today, on the Application tab.
- [x] Assignments and History are each one click from opening the drawer.
- [x] The notes show and edit on every tab.
- [x] The tabs are a tab list to assistive technology, and the every-control-is-named walk opens each.
