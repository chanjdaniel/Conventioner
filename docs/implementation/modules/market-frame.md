---
layer: implementation
kind: module
describes:
  - front-end/src/components/MarketFrame.vue
  - front-end/src/components/MarketBar.vue
  - front-end/src/components/MarketPages.vue
  - front-end/src/components/MarketArrival.vue
  - front-end/src/utils/marketPage.ts
verified: 2026-10-22
sources:
  - wayfinding/the-market-frame/map
  - wayfinding/the-market-frame/01
  - wayfinding/the-order-of-the-work/map
  - wayfinding/the-assignment-tab/02
  - E21/F04
  - E22/F04/S01
  - E22/F04/S02
  - E22/F04/S03
  - E26/F10/S01
  - E31/F03/S02
---

# The market frame

Every market screen stands in [`MarketFrame`](../../../front-end/src/components/MarketFrame.vue): a card whose top, the market's bar and the whole [phase rail](phase-rail.md), sticks under the app banner while the page scrolls.
Three layers are pinned, the app banner, the bar and the rail, about 150px at 1920x1080, a cost accepted for always seeing where the market is; and every screen that carries the rail carries the frame, since a frame pinned on one market screen and scrolling away on the next is the inconsistency it exists to remove.
The import, floorplan and start-from-CSV flows stand in it too.
A screen hands it the market from [the market store](market-store.md) and renders its own content in the frame's slot.

## What it draws

- **The bar**, [`MarketBar`](../../../front-end/src/components/MarketBar.vue): the market's name and its tabs, Market Setup, Application Form, Applications, Assignment and Attendance.
  It is rendered once, by the frame; a screen draws no title or Back button of its own.
  The underline is the tab being looked at, and the dot the tab the market is worked on in its phase; a tab opens the page carrying the dot when it holds it, else its first page.
  A CSV market's form tab is called "Questions".
- **The rail**, under the bar, once the market is in hand.
- **The page row**, [`MarketPages`](../../../front-end/src/components/MarketPages.vue), only for a tab with more than one page: the Assignment tab's Assignment, Result and Vendors.
- **A `pinned` slot** for a screen's own control that must stay in view with the frame, such as the vendor search.
- **The tab's note in place of the page** while the tab is out of its phase (`tabNote` in [the market guide](market-guide.md)), or **the screen's content**.

These are the frame's words: the market bar, a tab, the phase rail and a phase; "Market Setup" names a tab, never the page, and the plan is what it edits, each card of it a plan card.
A tab is a place to look and never a state: the market's state is its phase, on the rail alone.

**Every tab stays on the bar for the market's whole life**, Attendance included: `tabsFor()` returns all five in every phase, and a tab out of its phase says when it matters rather than disappearing.

[`front-end/src/utils/marketPage.ts`](../../../front-end/src/utils/marketPage.ts) says which tab holds which page (`TAB_PAGES`), which tab a flow stands under (import under Applications, floorplan and start-from-CSV under Market Setup), and which page a route is (`pageOfRoute`), the one reading of it so the bar and the page row can never disagree.
`hasAssignment` is the one statement of "an assignment is stored", read by the dot, the landing and the Result page.

## Sharp edges

**The frame places itself and says what shows until the market arrives.**
The page gutter (on three sides; the card hangs from the banner), the card's width, corners and white ground, and the loading, missing and failed states are the frame's own.
Until the market is in hand the bar holds its place and [`MarketArrival`](../../../front-end/src/components/MarketArrival.vue) says "Loading market…", that the market could not be loaded with a retry, or the one message for a market that is missing or not this organizer's.
A screen's content is rendered only once its market is in hand, and `@retry` lets a screen refetch its own data beside the market.
A screen that pads itself or renders its own arrival is how one market's pages came to put the frame in four different places.

**Sticky, never a scroller.**
The bar, the rail and everything the rail grows (a refused move's blockers, an error, the archived note) stick together at `top: var(--banner-h)`, the banner's height as a token.
Never give a frame screen an `overflow` scroller of its own: a sticky element inside an `overflow` ancestor silently stops sticking.
The pinned block's height is measured (a `ResizeObserver`) and published as `--market-frame-h` on the card, so a screen's own sticky column sits at `top: calc(var(--banner-h) + var(--market-frame-h))`.
The card is at least the height of the window under the banner, so a short page fills it.

**Every market screen is `--workspace-max` wide, and the frame sets it.**
A screen in the frame sets no width of its own, or moving between a market's screens makes the frame jump.
The market's name is whole wherever it fits beside the tabs, and ellipsed with its full name on hover only where it does not; the tabs never give way to it.

**On a phone the tabs scroll inside the bar.**
At 640px and below the name takes its own line and the tabs scroll sideways rather than widening the page; only Attendance reaches that width (see [attendance and the door](attendance-and-door.md)).

## Why

The bar and the whole rail pin as one block, whatever the rail grows, because the two alternatives prototyped each lost something the frame exists for: condensing on scroll hid every stage but the current one, which is the rail's reason to exist, and made the frame jump as it changed size; pinning one line and letting the blockers float laid "add market dates" over the very Dates card it asked the organizer to fix.

The layout decisions behind the frame (two widths, the frame stays put, the frame places itself) are in [the design language](../../design-system.md#layout).
Tables, Vendors and Attendance used to draw a title of their own with no tabs, so moving between a market's screens was two kinds of navigation; addresses are [every market page has an address](../conventions/every-market-page-has-an-address.md).

The glossary concept it serves: [Market](../../business/concepts/market.md).

## Superseded

- The market's page was "the market workspace" and its white container "the settings panel" (wayfinding/the-order-of-the-work/map); the page is the market frame's card, which every market screen shares (E21/F04).
