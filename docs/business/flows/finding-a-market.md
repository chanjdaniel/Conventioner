---
layer: business
kind: flow
verified: 2026-11-04
sources:
  - T209
  - wayfinding/readable-journey/07
  - E21/F02/S02
  - E22/F04/S02
  - E25/F01/S01
  - E31/F02/S02
  - E21/F02/S05
  - bug/14
  - bug/42
  - E14/F01/S02
  - T75
  - E39/F01/S04
  - E38/F08/S01
  - T142
  - T148
  - E38/F15/S03
  - T181
---

# Finding and opening markets

**Who:** a signed-in organizer.
**Where they start:** the Markets list, where sign-in lands.
**Serves:** [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

Every market page has its own address, built from the market's id, so a link to any page of a market opens that page ([every market page has an address](../../implementation/conventions/every-market-page-has-an-address.md)).

## What a market's row says

A market is one row wherever a list shows it (the Markets list, the old start screen's picker), drawn by `MarketSummaryCard.vue`: its name, its phase badge, its dates, and its organization.
A market whose organization is gone says "No longer available" there rather than dropping the line, which kept the rows from lining up.

- **Dates, not when it was created**: an organizer knows a market by when it runs.
- **The phase**: it is the market's state, and without it a running market looked exactly like a draft on the one screen that shows them all.
- **Not the reader's role**: that is permission detail on a list used to get somewhere, and Manage market says what each role may do there.
- **No progress counts**: the list does not carry them, and each would cost a query per row on a list that grows.

**The row itself opens the market**, on its own pages, in every phase, and on the keyboard its name is the button that does; Manage is the one control beside it, visible rather than behind a menu, since renaming, sharing and deleting a market are what an owner looks for there.
Opening never leads to the market's public page: a Google Form market has none, so opening a published one by its public page once answered "Page not found" for every market of the first release, and what an organizer wants of a published market, its check-in address, is on its rail ([the market lifecycle](lifecycle.md#where-the-check-in-address-lives)).

## C1. Signing in lands on Markets

**Status:** Works (`the-app-bar.spec.ts`).
**Task:** "Get back to the market you were working on."

Signing in lands on the Markets list, or on the page the address carried in `next` ([A2](accounts.md#a2-sign-in-and-sign-out)); "Previously opened" on the list is the way back to the market last opened ([C2](#c2-the-markets-list)).
`/` and `/dashboard`, which an older bookmark may hold, forward to it, by way of sign-in for someone signed out, and for someone signed in the logo in [the app bar](../../implementation/modules/app-bar.md) leads there from every page.
It fits a phone, since sign-in lands there on the way to the door (T148): at 390px nothing scrolls sideways or zooms out, whether or not the markets answer has arrived.
Covered by:
- `sign-in-fits-a-phone.spec.ts`
- `the-app-bar.spec.ts`

## C2. The markets list

**Status:** Works (walked live; the finder read from the code and `finding-a-market.spec.ts`).
`/markets` lists every market whose own page opens for the organizer ([what each role may do](../rules/what-each-role-may-do.md)), with its phase badge, dates ("Nov 17-21, 2025 (5 days)"; two separate days are named both, "Oct 3 and 10, 2026") and organization; a long name is cut with an ellipsis rather than wrapped (bug 14).
Above the list a finder narrows it: "Search" by market name as it is typed (case and accents do not count), "Organization", "Sort by" ("Market date", "Name", "Created") and a "Phase" toggle per stage the phase rail draws, in its order, so no "Offers", which nothing moves a market into (E38/F15/S03); once narrowed the count says "N of M markets", and when nothing matches the page says "No markets match these filters" and offers "Clear filters".
The finder's choices are held in the page's address; a value there that no longer means anything (an organization the organizer has left, a phase the finder does not offer, `offers` included) is dropped, so an old bookmark opens onto markets.
Clicking a card opens the market; "Manage", shown to anyone who may read the market, opens the Manage market dialog ([L3 to L5](ending-and-managing-a-market.md#l3-manage-who-has-access)), where each control asks its own row and everyone reads [who may do what](ending-and-managing-a-market.md#l3a-set-who-may-do-what) (E39/F01/S04).
The list fits a phone, since an organizer at the door finds the market there first (T142): at 390px nothing scrolls sideways, every control is a 44px target, and Manage market and the create-market dialog open inside the window.

**What it says first** is about the account, asked of the server, and arrives with the list, so nothing moves when the answer lands.

- **Previously opened:** one line above the finder names the market this browser last opened ([its pointer](../../implementation/modules/market-store.md)), with its phase badge at a desk, and at 640px and below the name keeps the room.
  The whole line is one 44px control that opens the market, on the keyboard too, and a long name is cut with an ellipsis.
  It shows when that market is among the account's markets and the account has more than one, and it is not a result of the finder, so filters do not hide it.
- **The market gone:** in its place, "The market you last opened is no longer available. Your other markets are still here.", or "The market you last opened is no longer available, and there are no others." when the account has none.
  It is said once, on the page's first successful read, and then forgotten, so the next visit is silent.
  A failed read says nothing and forgets nothing.
  Deleting that market in Manage on this page drops the line and forgets the market, with no note then or on the next visit.
- **No market yet:** with no market and nothing remembered, "You have not set up a market yet. Every market belongs to an organization - if you are not in one yet, create it under Organizations first.", "Organizations" being a link and "New market" in the page's header the step ([D4](creating-a-market.md#d4-create-a-market-with-no-organization-yet)).
  An account whose last market was deleted on this page reads "No markets found".

Covered by:
- `access-control.spec.ts`
- `finding-a-market.spec.ts`
- `markets-opening-words.spec.ts`

## C3. Open a market by its address

**Status:** Works (walked live).

1. `/markets/<id>` lands on the page the market is worked on in its phase (see [the lifecycle](lifecycle.md#the-phases)).
2. Every page has its own address: `/markets/<id>/setup`, `/form`, `/applications`, `/settings`, `/assignments`, `/vendors`, `/attendance`, `/stats`, plus the `/import`, `/start-from-csv` and `/floorplan` flows.
3. Old addresses redirect: `/markets/<id>/tables` and `/result` to `/assignments`, `/markets/<id>/assignment` to `/settings`, `setup?tab=<page>` to that page, `/market-setup` and the other id-less paths to `/markets`, `/floorplan-editor?marketId=<id>` to the floorplan flow.
4. An id you cannot reach shows "This market does not exist, or you do not have access to it." with "Choose a market".

Covered by:
- `every-market-page-has-an-address.spec.ts`
- `one-market-from-the-server.spec.ts`
- `the-frame-stays-put.spec.ts`

## C4. The navigation menu

**Status:** Works (walked live).
At a desk [the app bar](../../implementation/modules/app-bar.md) holds Markets and Organizations as links, the current one marked, and an account menu showing the address and holding Change password ([A4a](accounts.md#a4a-change-a-password-while-signed-in)) and Sign out.
At 640px and below the bar is the logo and a menu button at its right, which opens a sheet under the bar holding Markets and Organizations, the current one marked, the address, Change password and Sign out; choosing a row, Escape or a press outside it closes it.
Every organizer account has the same bar, whatever their role and on every page, a market's public page and "Page not found" included; someone not signed in sees the logo alone.
Covered by:
- `the-app-bar.spec.ts`
- `the-way-in-lines-up.spec.ts`

## C5. The old start screen

**Status:** No screen (reachable at `/init` by URL only).
Two buttons, "Set Up New Market" (opens the create-market dialog) and "Load Existing Market" (a market picker).
Nothing links to it; it predates the Markets list.

The rule on who sees which markets is [what each role may do](../rules/what-each-role-may-do.md); its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
