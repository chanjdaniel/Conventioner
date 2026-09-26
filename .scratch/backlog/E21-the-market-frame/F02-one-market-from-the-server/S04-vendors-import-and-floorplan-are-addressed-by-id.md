---
id: E21/F02/S04
title: Vendors, Import and the floorplan editor are addressed by id
type: story
status: ready
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

- [ ] Each of the three screens opens the market named in its path, reading it from the store, and none reads `localStorage` `market`.
- [ ] The old paths send the organizer to the Markets list.
- [ ] Every in-app link to these screens, and every link back from them, carries the market id.
- [ ] Returning to Market Setup after an import whose form amendment ran shows the amended form and the phase the chain returned to, with no reload.
- [ ] The e2e specs and page objects for these screens navigate by URL, and the full e2e suite passes.
