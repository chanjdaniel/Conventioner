---
layer: business
kind: flow
verified: 2026-10-22
sources:
  - E21/F02/S02
  - E22/F04/S02
  - E25/F01/S01
  - E31/F02/S02
  - bug/14
  - bug/42
---

# Finding and opening markets

**Who:** a signed-in organizer.
**Where they start:** the dashboard, where sign-in lands.

Every market page has its own address, built from the market's id, so a link to any page of a market opens that page ([every market page has an address](../../implementation/conventions/every-market-page-has-an-address.md)).

## C1. The dashboard

**Status:** Works (walked live).
**Task:** "Get back to the market you were working on."

After sign-in the dashboard shows one of:

- "Previously opened": a card for the last market this browser opened.
- "N markets are open to you." with "Open a market".
- "You have not set up a market yet. Every market belongs to an organization - if you are not in one yet, create it under Organizations first." with "Set up your first market", which opens the Markets list ([D4](creating-a-market.md#d4-create-a-market-with-no-organization-yet), bug 42).
- "The market you last opened is no longer available. Your other markets are still here." when it was deleted or access was lost, or "…and there are no others." with "Set up a market".

"Markets" and "Organizations" lead to those lists.
Covered by: `dashboard-market-count.spec.ts`.

## C2. The markets list

**Status:** Works (walked live; the finder read from the code and `finding-a-market.spec.ts`).
`/markets` lists every reachable market with its phase badge, dates ("Nov 17-21, 2025 (5 days)"; two separate days are named both, "Oct 3 and 10, 2026") and organization; a long name is cut with an ellipsis rather than wrapped (bug 14).
Above the list a finder narrows it: "Search" by market name as it is typed (case and accents do not count), "Organization", "Sort by" ("Market date", "Name", "Created") and a "Phase" toggle per phase; once narrowed the count says "N of M markets", and when nothing matches the page says "No markets match these filters" and offers "Clear filters".
The finder's choices are held in the page's address.
Clicking a card opens the market; "Manage", shown to someone who may manage the market, opens the Manage market dialog ([L3 to L5](ending-and-managing-a-market.md#l3-manage-who-has-access)).
Covered by: `dashboard-market-count.spec.ts`, `finding-a-market.spec.ts`, `access-control.spec.ts`.

## C3. Open a market by its address

**Status:** Works (walked live).

1. `/markets/<id>` lands on the page the market is worked on in its phase (see [the lifecycle](lifecycle.md#the-phases)).
2. Every page has its own address: `/markets/<id>/setup`, `/form`, `/applications`, `/assignment`, `/result`, `/vendors`, `/attendance`, plus the `/import`, `/start-from-csv` and `/floorplan` flows.
3. Old addresses redirect: `/markets/<id>/tables` to `/result`, `setup?tab=<page>` to that page, `/market-setup` and the other id-less paths to `/markets`, `/floorplan-editor?marketId=<id>` to the floorplan flow.
4. An id you cannot reach shows "This market does not exist, or you do not have access to it." with "Choose a market".

Covered by: `every-market-page-has-an-address.spec.ts`, `one-market-from-the-server.spec.ts`, `the-frame-stays-put.spec.ts`.

## C4. The navigation menu

**Status:** Works (walked live).
The menu button top left opens Markets, Organizations, "Market vendors" (only while a market is open; goes to its Vendors page) and Sign out.
Covered by: `the-way-in-lines-up.spec.ts`.

## C5. The old start screen

**Status:** No screen (reachable at `/init` by URL only).
Two buttons, "Set Up New Market" (opens the create-market dialog) and "Load Existing Market" (a market picker).
Nothing links to it; it predates the Markets list.

The rule on who sees which markets is [what each role may do](../rules/what-each-role-may-do.md); its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
