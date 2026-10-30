---
layer: business
kind: flow
describes:
  - front-end/src/components/MarketHistory.vue
  - front-end/src/components/HistorySection.vue
  - front-end/src/components/HistoryEntries.vue
  - front-end/src/utils/marketHistory.ts
  - front-end/src/utils/placementHistory.ts
  - front-end/e2e/the-markets-history.spec.ts
verified: 2026-10-30
sources:
  - E40/F01/S03
  - E40/F01/S04
  - T92
  - E38/F06/S01
  - E38/F07/S02
  - E38/F07/S03
---

# Reading the market's history

**Who:** anyone who may read the market's history, its row "Read the market's history", Viewer by default ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Markets list's "Manage", whose "Manage market" dialog holds the History section after "Users with access" ([managing a market](ending-and-managing-a-market.md#l3-manage-who-has-access)); the section is [`MarketHistory.vue`](../../../front-end/src/components/MarketHistory.vue), its heading [`HistorySection.vue`](../../../front-end/src/components/HistorySection.vue) and its list of changes [`HistoryEntries.vue`](../../../front-end/src/components/HistoryEntries.vue), both shared with Manage organization's History ([B7](organizations.md#b7-read-the-organizations-history)), and each sentence is worded by [`marketHistory.ts`](../../../front-end/src/utils/marketHistory.ts), a placement's by [`placementHistory.ts`](../../../front-end/src/utils/placementHistory.ts), the words the assignment history uses.

Every change on a market is recorded once, in one history: who, what, when, and what it was before and after ([the market's history](../../implementation/data/history.md)).
An organizer reads it to investigate a problem or a mistake, which is why it lives in Manage market, a step away from the market's daily running (Daniel, T92 Q24 and Q25).

## L6. Read the market's history

**Status:** Works (E2E-walked by `the-markets-history.spec.ts`; not yet walked live).

1. "Manage" on the market's row opens "Manage market", where "History" is a heading with a chevron, closed, so the sections after it stay in reach (Daniel, on T110's review).
   Opening it reads the newest 10 changes, newest first, inside the dialog's own scrolling; closing it and opening it again keeps what it read and its filters, until the dialog closes.
2. Each change is one sentence and its time: "e2e@example.com assigned Ana Rivera at B7 (Full Table) on Nov 19, 2026", "e2e@example.com changed priya@example.com from Viewer to Editor", "e2e@example.com set Ana Rivera to Approved", "e2e@example.com changed Ana Rivera from Approved to Rejected" (a verdict already given, changed, E38/F06/S01), "e2e@example.com changed Market Setup: sections", "e2e@example.com changed the prices: price groups" (a change of the Pricing card, naming what on it changed in the card's order, and opening to each field in the card's words and the market's money, "Gold $36, Silver $30", a row for each price group that changed (one added reads "not on the card" before it, one taken away "removed" after it): its prices, then each condition on its own line in the card's words, its question's label and the answers ticked quoted as the automatic rejections' reasons quote them (“Table choice” includes “Half a table, shared”), read from the market's own questions, and its stored key and value only for what the form no longer has, a wrapped condition hanging under its own line; each group's row headed by its name in the same quotes (Group “UBC student only”); where the groups stand in another order than they did, a row "Order of the groups" gives their names in each order (a group added last, or standing in a removed one's place, as a group renamed where it stands does, has not moved), beside any group that changed in the same write, so a move or a group added between others says where it went, since the card's order decides which group a price names when two price a vendor alike; a value keeps its line breaks, so a vendor note or an Update info answer of several lines reads as the drawer shows it), "e2e@example.com moved the market from Review to Assignment" (a phase named as that market's other screens name it: its one stage is "Review" on a Google Form market and "Applications" on one whose vendors apply on its page), "e2e@example.com stopped taking applications" and "e2e@example.com took applications again", "e2e@example.com changed Check vendors in from Editor to Admin" (a row of the market's own permission table, named by its label), "e2e@example.com set Check vendors in back to its default, Editor", "e2e@example.com reset Check vendors in and Move the phase to their built-in defaults" (the whole table reset, naming each row it returned), "Ana Rivera applied".
   A placement reads as [the assignment history](placing-by-hand.md#j13-assignment-history) says it, after who made it and before the day it is for, so the two never differ: a move names the table left and the table taken, "e2e@example.com moved Ana Rivera from A3 to B7 (Full Table) on Nov 19, 2026", and allocating tables reads "allocated tables: 40 assignments written, 3 pins preserved".
   An organizer's update of a vendor's answers reads "e2e@example.com updated the info of Ana Rivera".
   Both "applied" and an update of the info open to each answer under its question as the form asks it, in the form's order (the essential questions first, then the organizer's own), each read as the Application tab reads it, dates and tiers in words, and an answer that reads the same on both sides left out.
   A change the screen has no sentence for yet reads through the deliberate fallback "made a change: <row label>, about <vendor>"; one whose action no row of the table names reads "made a change", never the action's id.
3. A vendor named in a change is a link to the market's Vendors page with their drawer open (`?vendor=`, [the vendor drawer](vendor-drawer.md)); the dialog closes as the page changes.
4. "Before and after" under a change opens a table of each field it changed, as it was and as it is, and what else it recorded (a count, a date, where it was made); a phase reads as that market's other screens name it, a status and a role as the screens name them, and where a permission row came from as "Built in", "The organization's default" or "This market"; a reset of the whole table opens to each row it returned, by its label, as its role and where it came from ("Admin, This market" to "Editor, Built in").
5. "Load more", under the list while older changes remain, adds the next 10 beneath, in the open dialog.
   A change made in the dialog (a person given, changed or taken a role, a rename, a row of the permission table) reads the first page again, under the filters as they are, so it shows without reopening the dialog.
6. The filters above the list narrow it, and stay set while the dialog is open: "Who" (anyone who changed something as an organizer), "Kind of change" (the table's groups: Market Setup, Applications, Lifecycle, Vendors, Assignment, The door, People), "Vendor" (a name or part of an address, offering the market's vendors who gave a name and every address a loaded change names; while it matches several it says "2 vendors match. Keep typing, or choose one.", and a name or address that matches nobody narrows the list to nothing), and "From" and "To" (calendar days in the reader's timezone, both kept).
   "Clear filters" sets them all back; with nothing to show the list says "No change matches these filters.", or "Nothing has changed on this market yet." when unfiltered.

Someone below the row is shown no History section, and the server refuses them the read in the row's words.
Someone who may read it and never opens the section asks nothing of the server.
An archived market's history is still read: reading it is not a change ([an archived market is read-only](../rules/an-archived-market-is-read-only.md)).

## One vendor's history

A vendor's drawer reads the same history narrowed to that vendor on its History tab: the same component given the vendor, so the same sentences, "Before and after" and "Load more", with no filters, and the vendor named by name alone ([the vendor drawer](vendor-drawer.md)).
A deal of many applications ([the review is dealt among chosen reviewers](../rules/the-review-is-dealt-among-chosen-reviewers.md)) reads there as that vendor's own line, "dealt the application to <address>", and opens to their reviewer alone, before and after; in the market's History it reads "chose the reviewers: …", "changed the reviewers: added …, removed …" or "removed every reviewer", and "dealt N open applications among M reviewers", or "dealt the application of <vendor> to <address>" when it moved one, and a removed reviewer's follow-up "dealt the follow-up of <vendor> from <address> to <address>"; a verdict on someone else's share ends ", dealt to <address>", and in a selection's sentence each such vendor is followed by "(dealt to <address>)"; an applicant's own arrival reads "The application of <vendor> was dealt to <address> as it arrived", in their drawer "The application was dealt to <address> as it arrived".
The server narrows it to the changes that name the vendor, so a run of the assignment, which names nobody, is in no vendor's list.
Someone below the row is shown no History tab, as no History section.

## The rules it obeys

- [What each role may do](../rules/what-each-role-may-do.md): the row "Read the market's history".
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md): it still reads.

Covered by: [`the-markets-history.spec.ts`](../../../front-end/e2e/the-markets-history.spec.ts), `the-vendors-history.spec.ts` for one vendor's, and `manageMarketHistory.test.ts`, `theDrawersHistory.test.ts` and `marketHistory.test.ts` for the filters, the paging and the words ([walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map)).
