---
layer: implementation
kind: convention
describes:
  - front-end/src/router/index.ts
  - front-end/src/utils/market.ts#marketPath
  - front-end/src/utils/market.ts#resolutionPath
  - front-end/src/utils/market.ts#openMarket
  - front-end/src/views/MarketLanding.vue
  - front-end/src/utils/vendorDrawer.ts
  - front-end/src/utils/market.ts#isHere
verified: 2026-11-10
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
  - E44/F02/S01
  - E38/F13/S01
  - T200
  - T209
  - T206
  - T223
---

# Every market page has an address

**Every market page has its own address, and every market screen is addressed by the market's id.**
A link to any of them, bookmarked, shared or opened in a second browser tab, opens that page of that market; nothing about which market is open lives anywhere but the URL and [the market store](../modules/market-store.md).

The glossary concept: [Market](../../business/concepts/market.md).

## The addresses

The routes are in [`front-end/src/router/index.ts`](../../../front-end/src/router/index.ts):

- `/markets/:marketId/{setup,form,applications,settings}` are the pages of one view, `MarketSetupView` (`SETUP_VIEW_PAGES`); `settings` is the Assignment tab's Settings page, apart from `setup`, Market Setup's plan.
- The Application Form tab keeps its step in its query, `form?step=<essentials|questions|preview|review>`, so a blocker's fix, a bookmark or a shared link opens Review setup as `form?step=review` (T206); no step, an unknown one, or one the path lacks (`preview` on a Google Form market) opens the step the tab opens with none ([building the application form](../../business/flows/form-tab.md)).
- `/markets/:marketId/assignments`, `/vendors`, `/payments`, `/attendance`, `/tools` and `/stats` are views of their own; the Payments page keeps its filter, search and sort in its query ([payments](../../business/flows/payments.md)), and the Vendors page its search beside its filters, as `search` ([vendors](../../business/flows/vendors.md)).
- Applications All keeps its filter, Mine, "Assigned to" and search in its query beside the view, as `status`, `mine`, `reviewer` and `search` ([reviewing applications](../../business/flows/review.md#the-all-view)).
- `/markets/:marketId/import`, `/floorplan` and `/start-from-csv` are flows, entered from a tab rather than places to go; each stands under one tab, the import under Applications and the other two under Market Setup (see [the market frame](../modules/market-frame.md)).
- `/dev/components` and `/dev/components/:entry` are not market pages either: they are the [component library](../modules/component-library.md), registered only in a development build, so in production they are "page not found" as any unknown address is.
- `/discord/connected` is not a market page: it is where Discord's approval screen sends the organizer back, its market named by the state it carries, in the tab Connect Discord opened; it says the outcome and links to that market's Tools ([the Discord connection](../modules/discord.md)).
- `/:marketSlug` alone is the vendor page, [`VendorPage`](../../../front-end/src/views/VendorPage.vue), flagged `meta.vendorFacing` so the app bar shows it the vendors' way to everyone, an organizer included.
  A slug naming no market, or a gated market's (a draft's included), answers "Page not found" on the same route, and the organizer keeps the full bar there ([the app bar](../modules/app-bar.md)).
- `/markets/:marketId` alone is [`MarketLanding`](../../../front-end/src/views/MarketLanding.vue), which opens the market, shows the frame's arrival, and then replaces itself with the page the market is worked on in its phase: `currentPage` in [the market guide](../modules/market-guide.md), a reading of the guide's table.
  Opening a market from the list, its "Previously opened" line or a new market all come through it ([`openMarket`](../../../front-end/src/utils/market.ts)), so none of them has to know which page a phase belongs to.

**Every address is built with [`marketPath()`](../../../front-end/src/utils/market.ts)**; nothing spells a market path by hand.

## A page's own state is replaced, the drawer's opening is pushed

A page's filter, view or date kept in its query changes with `router.replace`, so a link and a refresh agree with what is on screen and Back leaves the page rather than stepping through them.
The [vendor drawer](../../business/flows/vendor-drawer.md) is the one part of a page whose opening is a step of its own ([`useVendorDrawer`](../../../front-end/src/utils/vendorDrawer.ts), E38/F13/S01): opening it from closed pushes `?vendor=` with `vendorDrawer: true` in the entry's `history.state`, and closing it goes `router.back()` when that entry is the drawer's own and the one before it is the same page without the drawer, so Back (a phone's back gesture, the browser's button) closes it and stays on the page, its filter and scroll as they were.
Its tab and another vendor while it is open replace the entry, a vendor its History tab names on the Vendors page included, so one Back closes it; a drawer reached by a link has no step of its own to take back, and closing it replaces the address instead, so it never leaves the site.

## Old addresses

Two old names of a market's pages forward, each with its query: `/markets/:marketId/assignment` to `settings` and `/markets/:marketId/result` to `assignments`.
The Assignment and Result pages took those names ([the assignment and its result](../../business/flows/assignment-and-result.md)) after production's release of 2026-10-18, which still serves the old ones, so they are what organizers have bookmarked; they can go after a release or two.
`/dashboard`, where signing in landed until Markets took over, and `/` forward to `/markets`.

Nothing else is kept for an old link, since nothing links to it:

- `/init`, `/register`, `/vendors`, `/market-setup`, `/import-applications`, `/assignment-results` and `/floorplan-editor` fall to `/:marketSlug`, so each answers as a market that does not exist, and a market may hold the name.
- `/markets/:marketId/tables` falls to the catch-all, "Page not found".
- `setup?tab=<page>` opens the plan: nothing reads `tab`.

## A guard names a page

A transition guard's `resolution_link` (in [`back-end/guards.py`](../../../back-end/guards.py)) names a page of the market relative to its own pages, such as `applications` or `setup`, perhaps with a query, and never which market or a redirect.
[`resolutionPath()`](../../../front-end/src/utils/market.ts) is the one reading of it, for the rail's fix and the blocker panel alike.
Neither offers a link to the page the reader is on.
The rail asks [`isHere()`](../../../front-end/src/utils/market.ts): the same path, and every query value the link names, so `form?step=review` is offered from Your questions and not on Review setup, and `applications` is not offered on `applications?view=one`.
The blocker panel compares the resolved full address.

## What breaks it

- A screen that reads its market from anything but the route's id.
- A link built by string concatenation instead of `marketPath()`.
- A `resolution_link` naming an old address: it would be followed through a forward, or to "Page not found".
- A new market page added without its route, so it cannot be bookmarked.

What an organizer sees of the addresses, from the Markets list to an old bookmark, is [finding and opening markets](../../business/flows/finding-a-market.md).

## Superseded

- Addressing market screens by the market's id was ruled out of scope, with a guard on the screens that read no market instead (wayfinding/readable-journey/map); every market screen is addressed by its id (wayfinding/the-market-frame/03, E21/F02/S02).
