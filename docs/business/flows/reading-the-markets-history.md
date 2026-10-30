---
layer: business
kind: flow
describes:
  - front-end/src/components/MarketHistory.vue
  - front-end/src/utils/marketHistory.ts
  - front-end/src/utils/placementHistory.ts
  - front-end/e2e/the-markets-history.spec.ts
verified: 2026-10-30
sources:
  - E40/F01/S03
  - T92
  - E41/F01/S02
---

# Reading the market's history

**Who:** anyone who may read the market's history, its row "Read the market's history", Viewer by default ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Markets list's "Manage", whose "Manage market" dialog holds the History section after "Users with access" ([managing a market](ending-and-managing-a-market.md#l3-manage-who-has-access)); the section is [`MarketHistory.vue`](../../../front-end/src/components/MarketHistory.vue), and each sentence is worded by [`marketHistory.ts`](../../../front-end/src/utils/marketHistory.ts), a placement's by [`placementHistory.ts`](../../../front-end/src/utils/placementHistory.ts), the words the assignment history uses.

Every change on a market is recorded once, in one history: who, what, when, and what it was before and after ([the market's history](../../implementation/data/history.md)).
An organizer reads it to investigate a problem or a mistake, which is why it lives in Manage market, a step away from the market's daily running (Daniel, T92 Q24 and Q25).

## L6. Read the market's history

**Status:** Works (E2E-walked by `the-markets-history.spec.ts`; not yet walked live).

1. "Manage" on the market's row opens "Manage market", where "History" is a heading with a chevron, closed, so the sections after it stay in reach (Daniel, on T110's review).
   Opening it reads the newest 10 changes, newest first, inside the dialog's own scrolling; closing it and opening it again keeps what it read and its filters, until the dialog closes.
2. Each change is one sentence and its time: "e2e@example.com assigned Ana Rivera at B7 (Full Table) on Nov 19, 2026", "e2e@example.com changed priya@example.com from Viewer to Editor", "e2e@example.com set Ana Rivera to Approved", "e2e@example.com changed Market Setup: sections", "e2e@example.com moved the market from Review to Assignment" (a phase named as that market's other screens name it: its one stage is "Review" on a Google Form market and "Applications" on one whose vendors apply on its page), "e2e@example.com stopped taking applications" and "e2e@example.com took applications again", "e2e@example.com changed Check vendors in from Editor to Admin" (a row of the market's own permission table, named by its label), "e2e@example.com set Check vendors in back to its default, Editor", "e2e@example.com reset Check vendors in and Move the phase to their built-in defaults" (the whole table reset, naming each row it returned), "Ana Rivera applied".
   A placement reads as [the assignment history](placing-by-hand.md#j13-assignment-history) says it, after who made it and before the day it is for, so the two never differ: a move reads as the table taken, its table left in its before and after, and allocating tables reads "allocated tables: 40 assignments written, 3 pins preserved".
   A change the screen has no sentence for yet, such as the "Update a vendor's info" row, reads through the deliberate fallback "made a change: <row label>, about <vendor>".
3. A vendor named in a change is a link to the market's Vendors page with their drawer open (`?vendor=`, [the vendor drawer](vendor-drawer.md)); the dialog closes as the page changes.
4. "Before and after" under a change opens a table of each field it changed, as it was and as it is, and what else it recorded (a count, a date, where it was made); a phase reads as that market's other screens name it, a status and a role as the screens name them, an essential question's answer as the review card shows it, under the question's label ([an update is kept beside the vendor's answer](../rules/an-update-is-kept-beside-the-vendors-answer.md)), and where a permission row came from as "Built in", "The organization's default" or "This market"; a reset of the whole table opens to each row it returned, by its label, as its role and where it came from ("Admin, This market" to "Editor, Built in").
5. "Load more", under the list while older changes remain, adds the next 10 beneath, in the open dialog.
6. The filters above the list narrow it, and stay set while the dialog is open: "Who" (anyone who changed something as an organizer), "Kind of change" (the table's groups: Market Setup, Applications, Lifecycle, Vendors, Assignment, The door, People), "Vendor" (a name or part of an address, offering the market's vendors who gave a name and every address a loaded change names; while it matches several it says "2 vendors match. Keep typing, or choose one.", and a name or address that matches nobody narrows the list to nothing), and "From" and "To" (calendar days in the reader's timezone, both kept).
   "Clear filters" sets them all back; with nothing to show the list says "No change matches these filters.", or "Nothing has changed on this market yet." when unfiltered.

Someone below the row is shown no History section, and the server refuses them the read in the row's words.
Someone who may read it and never opens the section asks nothing of the server.
An archived market's history is still read: reading it is not a change ([an archived market is read-only](../rules/an-archived-market-is-read-only.md)).

## The rules it obeys

- [What each role may do](../rules/what-each-role-may-do.md): the row "Read the market's history".
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md): it still reads.

Covered by: [`the-markets-history.spec.ts`](../../../front-end/e2e/the-markets-history.spec.ts), and `manageMarketHistory.test.ts` and `marketHistory.test.ts` for the filters, the paging and the words ([walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map)).
