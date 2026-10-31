---
layer: implementation
kind: convention
describes:
  - front-end/src/router/index.ts
  - front-end/src/utils/market.ts#marketPath
  - front-end/src/utils/market.ts#resolutionPath
  - front-end/src/utils/market.ts#openMarket
  - front-end/src/views/MarketLanding.vue
verified: 2026-10-31
sources:
  - wayfinding/readable-journey/map
  - wayfinding/the-assignment-tab/01
  - wayfinding/the-market-frame/03
  - wayfinding/the-assignment-tab/02
  - wayfinding/the-assignment-tab/map
  - E21/F02/S02
  - E22/F04/S02
  - E21/F02
  - E21/F02/S04
  - E45/F01/S01
  - E38/F08/S01
  - E46/F01/S02
---

# Every market page has an address

**Every market page has its own address, and every market screen is addressed by the market's id.**
A link to any of them, bookmarked, shared or opened in a second browser tab, opens that page of that market; nothing about which market is open lives anywhere but the URL and [the market store](../modules/market-store.md).

The glossary concept: [Market](../../business/concepts/market.md).

## The addresses

The routes are in [`front-end/src/router/index.ts`](../../../front-end/src/router/index.ts):

- `/markets/:marketId/{setup,form,applications,settings}` are the pages of one view, `MarketSetupView` (`SETUP_VIEW_PAGES`); `settings` is the Assignment tab's Settings page, apart from `setup`, Market Setup's plan.
- `/markets/:marketId/assignments`, `/vendors`, `/attendance`, `/tools` and `/stats` are views of their own.
- `/markets/:marketId/import`, `/floorplan` and `/start-from-csv` are flows, entered from a tab rather than places to go; each stands under one tab, the import under Applications and the other two under Market Setup (see [the market frame](../modules/market-frame.md)).
- `/discord/connected` is not a market page: it is where Discord's approval screen sends the organizer back, its market named by the state it carries, in the tab Connect Discord opened; it says the outcome and links to that market's Tools ([the Discord connection](../modules/discord.md)).
- `/markets/:marketId` alone is [`MarketLanding`](../../../front-end/src/views/MarketLanding.vue), which opens the market, shows the frame's arrival, and then replaces itself with the page the market is worked on in its phase: `currentPage` in [the market guide](../modules/market-guide.md), a reading of the guide's table.
  Opening a market from a list, the dashboard or a new market all come through it ([`openMarket`](../../../front-end/src/utils/market.ts)), so none of them has to know which page a phase belongs to.

**Every address is built with [`marketPath()`](../../../front-end/src/utils/market.ts)**; nothing spells a market path by hand.

## Old addresses

- `setup?tab=<page>` lands on the page it named, keeping the rest of its query; `setup?tab=assignment` lands on `settings`.
- `/markets/:marketId/assignment` redirects to `settings`, and `/markets/:marketId/result` and `/markets/:marketId/tables` to `assignments`, each with its query: the Tables screen became the Result page, and the Assignment and Result pages became Settings and Assignments ([the assignment and its result](../../business/flows/assignment-and-result.md)).
- `/floorplan-editor?marketId=` opens that market's floorplan flow: unlike the other old paths it carried the market's id, so an old link still opens the market it named.
- The id-less paths (`/market-setup`, `/vendors`, `/import-applications`, `/floorplan-editor` with no id, `/assignment-results`) redirect to `/markets`: they never held an id to preserve.

## A guard names a page

A transition guard's `resolution_link` (in [`back-end/guards.py`](../../../back-end/guards.py)) names a page of the market relative to its own pages, such as `applications` or `setup`, perhaps with a query, and never which market or a redirect.
[`resolutionPath()`](../../../front-end/src/utils/market.ts) is the one reading of it, for the rail's fix and the blocker panel alike.

## What breaks it

- A screen that reads its market from anything but the route's id.
- A link built by string concatenation instead of `marketPath()`.
- A `resolution_link` naming an old address: it would be followed through a redirect, or nowhere.
- A new market page added without its route, so it cannot be bookmarked.

What an organizer sees of the addresses, from the Markets list to an old bookmark, is [finding and opening markets](../../business/flows/finding-a-market.md).

## Superseded

- Addressing market screens by the market's id was ruled out of scope, with a guard on the screens that read no market instead (wayfinding/readable-journey/map); every market screen is addressed by its id (wayfinding/the-market-frame/03, E21/F02/S02).
