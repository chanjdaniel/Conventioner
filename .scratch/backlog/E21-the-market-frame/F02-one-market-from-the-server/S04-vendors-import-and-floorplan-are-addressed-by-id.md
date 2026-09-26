---
id: E21/F02/S04
title: Vendors, Import and the floorplan editor are addressed by id
type: story
status: done
blocked_by: [E21/F02/S01]
pr: []
---

## What to build

The three remaining market screens that do not carry an id in their path move under `/markets/:marketId/`, and read the market from the store.

- Vendors: `/vendors` becomes `/markets/:marketId/vendors`.
- Import: `/import-applications` becomes `/markets/:marketId/import`. Its form amendment chain moves phases and rewrites the form; it is followed by a re-fetch like any other write.
- Floorplan editor: `/floorplan-editor?marketId=` becomes `/markets/:marketId/floorplan`.

The id-less paths send the organizer to the Markets list.
Every in-app link to these screens (from the Applications tab, the Assignment tab, Tables, and the plan's Section Setup card) uses the new paths, and the Tables and Vendors "back" links return to the right market.

## Acceptance criteria

- [x] Each of the three screens opens the market named in its path, reading it from the store, and none reads `localStorage` `market`.
- [x] The old paths send the organizer to the Markets list.
- [x] Every in-app link to these screens, and every link back from them, carries the market id.
- [x] Returning to Market Setup after an import whose form amendment ran shows the amended form and the phase the chain returned to, with no reload.
- [x] The e2e specs and page objects for these screens navigate by URL, and the full e2e suite passes.

## Built differently, on purpose

`/floorplan-editor?marketId=X` redirects to `/markets/X/floorplan` instead of to the Markets list.
Unlike the other id-less paths, it did carry the market's id, so an old link can still open the market it named. `/vendors` and `/import-applications` go to the Markets list as specified.
The floorplan editor also reads its market from the store, with the same arrival states as every other market screen (added in code review).
