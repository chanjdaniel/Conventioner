---
id: E35/F02/S02
title: Change placement shows the vendor's table
type: story
status: in-progress
blocked_by: [E35/F02/S01]
pr: []
---

## What to build

Change placement, on a placement in the vendor drawer, opens the results with the search set to that vendor and the date set to that placement's date, so their table is the one shown and can be changed at once.

## As built

- The drawer's placement link (`resultLinkFor` in `VendorDrawer.vue`) sets `?date=` and `?search=<address>`, the search of `S01`, in place of `?vendor=`.
  Since `F01/S02` the Result page opens the drawer from `?vendor=`, so the old link would have opened the drawer over the table it was meant to show.
- A whole address matches exactly (`WHOLE_ADDRESS` in `utils/resultFilters.ts`), so the link shows that vendor's table and not the table of someone whose address or answer contains theirs; part of an address still matches as part.
- `seedMarketWithVendors` and `seedAssignedMarket` take `dates`, for a spec that needs a market of more than one date.

## Acceptance criteria

- [x] From a vendor's placement on day 2, Change placement shows only their day-2 table.
- [x] Clearing the filters shows the whole result.
