---
layer: implementation
kind: module
describes:
  - front-end/src/components/MarketFrame.vue
  - front-end/src/components/MarketBar.vue
  - front-end/src/components/MarketPages.vue
  - front-end/src/components/MarketArrival.vue
  - front-end/src/utils/marketPage.ts
  - front-end/src/views/ToolsView.vue
verified: 2026-10-30
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
  - E21/F04/S01
  - E21/F04/S02
  - T15
  - E45/F01/S01
  - E38/F01/S01
  - E46/F01/S02
---

# The market frame

Every market screen stands in [`MarketFrame`](../../../front-end/src/components/MarketFrame.vue): a card whose top, the market's bar and the whole [phase rail](phase-rail.md), sticks under the app banner while the page scrolls.
Three layers are pinned, the app banner, the bar and the rail, about 150px at 1920x1080, a cost accepted for always seeing where the market is; and every screen that carries the rail carries the frame, since a frame pinned on one market screen and scrolling away on the next is the inconsistency it exists to remove.
The import, floorplan and start-from-CSV flows stand in it too.
A screen hands it the market from [the market store](market-store.md) and renders its own content in the frame's slot.

## What it draws

- **The bar**, [`MarketBar`](../../../front-end/src/components/MarketBar.vue): the market's name and its seven tabs, Market Setup, Application Form, Applications, Assignment, Attendance, Tools and Stats.
  It is rendered once, by the frame; a screen draws no title or Back button of its own.
  The underline is the tab being looked at, and the dot the tab the market is worked on in its phase; a tab opens the page carrying the dot when it holds it, else its first page.
  A CSV market's form tab is called "Questions".
- **The rail**, under the bar, once the market is in hand.
- **The page row**, [`MarketPages`](../../../front-end/src/components/MarketPages.vue), only for a tab with more than one page: the Assignment tab's Assignment, Result and Vendors.
- **A `pinned` slot** for a screen's own control that must stay in view with the frame, such as the vendor search.
- **The tab's note in place of the page** while the tab is out of its phase (`tabNote` in [the market guide](market-guide.md)), or **the screen's content**.
  The note stands in for a tab's pages only, never for a flow the tab holds: a Google Form market's first import is the work its draft Applications tab is waiting on (E38/F04/S01).
- **Why the person looking may change nothing**, the market read's `readOnlyReason`, once, under the rail and above the page, on every page of the market ([what each role may do](../../business/rules/what-each-role-may-do.md)).
  The server sets it when the market is archived or none of the table's changing actions is the person's ([the market's actions](market-actions.md#what-the-screens-read)); the frame decides nothing about who may.
  Not on an archived market, which the rail says ([an archived market is read-only](../../business/rules/an-archived-market-is-read-only.md)), and not beside a tab's note, which stands in for the page.

These are the frame's words: the market bar, a tab, the phase rail and a phase; "Market Setup" names a tab, never the page, and the plan is what it edits, each card of it a plan card.
A tab is a place to look and never a state: the market's state is its phase, on the rail alone.

**Every tab stays on the bar for the market's whole life**, Attendance included: `tabsFor()` returns all seven in every phase, and a tab out of its phase says when it matters rather than disappearing.
Stats, last, has no phase of its own and no note: it reads the market from its first application to its archive, and says "Nobody has applied yet." until someone has.
Tools, just left of it, has none either: it holds the manual tools an organizer runs whenever they choose, each a card of a `.card-grid` on the page's inset, the [Discord card](discord.md) first ([`ToolsView.vue`](../../../front-end/src/views/ToolsView.vue)).

[`front-end/src/utils/marketPage.ts`](../../../front-end/src/utils/marketPage.ts) says which tab holds which page (`TAB_PAGES`), which tab a flow stands under (import under Applications, floorplan and start-from-CSV under Market Setup), and which page a route is (`pageOfRoute`), the one reading of it so the bar and the page row can never disagree.
`hasAssignment` is the one statement of "an assignment is stored", read by the dot, the landing and the Result page.

## Sharp edges

**The frame places itself and says what shows until the market arrives.**
The page gutter (on three sides; the card hangs from the banner), the card's width, corners and white ground, and the loading, missing and failed states are the frame's own.
Until the market is in hand the bar holds its place and [`MarketArrival`](../../../front-end/src/components/MarketArrival.vue) says "Loading market…", that the market could not be loaded with a retry, or the one message for a market that is missing or not this organizer's.
A screen's content is rendered only once its market is in hand, and `@retry` lets a screen refetch its own data beside the market.
A screen that pads itself or renders its own arrival is how one market's pages came to put the frame in four different places.
A page inside the card insets its content `--space-6`, the rail's inset, so what the frame says above a page (`market-read-only`) lines up with it; Market Setup's tabs were 40px in until T15.

**Sticky, never a scroller.**
The bar, the rail and everything the rail grows (a refused move's blockers, an error, the archived note) stick together at `top: var(--banner-h)`, the banner's height as a token.
Never give a frame screen an `overflow` scroller of its own: a sticky element inside an `overflow` ancestor silently stops sticking.
The pinned block's height is measured (a `ResizeObserver`) and published as `--market-frame-h` on the card, so a screen's own sticky column sits at `top: calc(var(--banner-h) + var(--market-frame-h))`.
The card is at least the height of the window under the banner, so a short page fills it.

**A page says only its own lock; the frame says the person's.**
The plan says why its setup settled (`setupLockReason`), the form's steps why the form locked, and the Assignment page why its rules settled; each disables a control on the table's answer for the action it takes (`mayTake`, [the market store](market-store.md#where-a-screens-permission-comes-from)), but none repeats `readOnlyReason`, or a Viewer reads the same sentence twice on one page.
The floorplan flow stands in for its wizard on either reason and says only the setup's.

**Every market screen is `--workspace-max` wide, and the frame sets it.**
A screen in the frame sets no width of its own, or moving between a market's screens makes the frame jump.
The market's name is whole wherever it fits beside the tabs, and ellipsed with its full name on hover only where it does not; the tabs never give way to it.

**On a phone the tabs scroll inside the bar.**
At 640px and below the name takes its own line and the tabs scroll sideways rather than widening the page, since seven tabs are wider than a phone; only Attendance and Tools reach that width (see [attendance and the door](attendance-and-door.md)).
A focused tab wears the white halo for the dark bar, drawn inside the tab there, since the scroller clips anything drawn outside it ([the design language](../../design-system.md#the-primitive-layer)).
[`the-stats-tab.spec.ts`](../../../front-end/e2e/the-stats-tab.spec.ts) measures both widths: at 1280 the seven tabs hold one row beside a 60-character name on the form path, whose "Application Form" is the widest bar, the name ellipsing; at 390 the tabs scroll inside the bar and the page does not scroll sideways.

## Why

The bar and the whole rail pin as one block, whatever the rail grows, because the two alternatives prototyped each lost something the frame exists for: condensing on scroll hid every stage but the current one, which is the rail's reason to exist, and made the frame jump as it changed size; pinning one line and letting the blockers float laid "add market dates" over the very Dates card it asked the organizer to fix.

Four tabs, with the Assignment tab's pages in a row under the rail, won over two other navigations prototyped on every market screen: a flat bar of six tabs put Vendors and Attendance on it with nothing to show before an assignment, and only just fit beside a long name at 1280; the market's screens listed down the frame's left side cost 200px of every market screen and looked like nothing else in the product.
The bar holds seven tabs since Attendance stayed on it for the market's whole life (E31/F03/S02), Stats joined it (E45/F01/S01) and Tools joined it (E46/F01/S02), while Vendors stays a page of the Assignment tab; Stats is a tab rather than a page under Applications because the figures planned for it, seats and money among them, would sit oddly under the applications (Daniel's choice in T92's planning).
Seven tabs still fit beside a long name at 1280 because the name, never the tabs, gives way.
Tools is a tab of its own, immediately left of Stats, by Daniel's hand walk of E46/F01/S02: a tool runs in any phase, while the plan it used to stand beneath settles on leaving draft.
The page row is what makes the tab's name, repeated as its first page's, read as "the tab, and its first page"; Result and Vendors beside each other are the assignment by table and by vendor.

The layout decisions behind the frame (two widths, the frame stays put, the frame places itself) are in [the design language](../../design-system.md#layout).
Tables, Vendors and Attendance used to draw a title of their own with no tabs, so moving between a market's screens was two kinds of navigation; addresses are [every market page has an address](../conventions/every-market-page-has-an-address.md).

The glossary concept it serves: [Market](../../business/concepts/market.md).

## Superseded

- Only Market Setup said why a person could change nothing, so a Viewer met Result's seats as plain text and took the page for broken; the frame says it on every page, and Market Setup's plan says only its own lock (T15).

- Attendance was to join the bar once the market was published, so the bar grew with the market (wayfinding/the-assignment-tab/02); every tab stays on the bar for the market's whole life, and a tab out of its phase says when it matters (E31/F03/S02).
- The market's page was "the market workspace" and its white container "the settings panel" (wayfinding/the-order-of-the-work/map); the page is the market frame's card, which every market screen shares (E21/F04).
- The list screens' Back rows sat in a `footer` slot of the frame, pinned to the bottom of the window so they stayed reachable at any scroll (E21/F04/S02); the frame has no footer, and a screen draws no Back button, since every page is reached from a tab or the page row (wayfinding/the-assignment-tab/02).
