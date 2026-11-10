---
layer: business
kind: flow
describes:
  - front-end/src/components/MarketHistory.vue
  - front-end/src/components/AssignmentHistoryDialog.vue
  - front-end/src/components/HistorySection.vue
  - front-end/src/components/HistoryEntries.vue
  - front-end/src/components/PagedList.vue
  - front-end/src/utils/useHistoryPages.ts
  - front-end/src/utils/marketHistory.ts
  - front-end/src/utils/addressParts.ts
  - front-end/src/components/EmailAddress.vue
  - front-end/e2e/the-markets-history.spec.ts
  - front-end/e2e/an-address-breaks-only-before-its-at.spec.ts
  - front-end/src/utils/historyReaders/
  - front-end/src/utils/personChoice.ts
verified: 2026-11-10
sources:
  - E40/F01/S03
  - E40/F01/S04
  - T92
  - E41/F01/S02
  - E38/F06/S01
  - E38/F07/S02
  - E38/F07/S03
  - E39/F02/S01
  - E44/F01/S02
  - E46/F01/S03
  - E38/F10/S01
  - E46/F01/S05
  - E46/F01/S04
  - T137
  - E38/F13/S01
  - T181
  - T223
  - T224
  - T263
---

# Reading the market's history

**Who:** anyone who may read the market's history, its row "Read the market's history", Viewer by default ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Markets list's "Manage", whose "Manage market" dialog holds the History section after "Users with access" ([managing a market](ending-and-managing-a-market.md#l3-manage-who-has-access)); the section is [`MarketHistory.vue`](../../../front-end/src/components/MarketHistory.vue), its heading [`HistorySection.vue`](../../../front-end/src/components/HistorySection.vue) and its list of changes [`HistoryEntries.vue`](../../../front-end/src/components/HistoryEntries.vue), both shared with Manage organization's History ([B7](organizations.md#b7-read-the-organizations-history)), and each sentence is worded by [`marketHistory.ts`](../../../front-end/src/utils/marketHistory.ts) from each area's own file under [`historyReaders/`](../../../front-end/src/utils/historyReaders/).

Every change on a market is recorded once, in one history: who, what, when, and what it was before and after ([the market's history](../../implementation/data/history.md)).
An organizer reads it to investigate a problem or a mistake, which is why it lives in Manage market, a step away from the market's daily running (Daniel, T92 Q24 and Q25).

## L6. Read the market's history

**Status:** Works (E2E-walked by `the-markets-history.spec.ts`; not yet walked live).

1. "Manage" on the market's row opens "Manage market", where "History" is a heading with a chevron, closed, so the sections after it stay in reach (Daniel, on T110's review).
   Opening it reads the newest 25 changes, newest first, in a box of its own under the filters; closing it and opening it again keeps what it read and its filters, until the dialog closes, and a closed section reads no further.
2. Each change is one sentence and its time.
   An address in it, who made the change, a vendor's beside their name or whose share a verdict was, breaks as an address in the table does (step 4).
   Its examples are one kind a line, in the order of the blocks of [what each write records](../../implementation/data/history.md#what-each-write-records), so a new kind's example is one line in its block's place ([two features never share a line](../../implementation/conventions/two-features-never-share-a-line.md#reading-the-markets-history)):
   - "e2e@example.com changed Market Setup: sections"
   - "e2e@example.com changed the prices: price groups" (a change of the Pricing card, naming what on it changed in the card's order, and opening to each field in the card's words and the market's money, "Gold $36.00, Silver $30.00", a row for each price group that changed (one added reads "not on the card" before it, one taken away "removed" after it): its prices, then each condition on its own line in the card's words, its question's label and the answers ticked quoted as the automatic rejections' reasons quote them (“Table choice” includes “Half a table, shared”), read from the market's own questions, and its stored key and value only for what the form no longer has, a wrapped condition hanging under its own line; each group's row headed by its name in the same quotes (Group “Example College student only”); where the groups stand in another order than they did, a row "Order of the groups" gives their names in each order (each added group judged by its own place among the kept ones: a group added last, or standing in a removed one's place, as a group renamed where it stands does, has not moved, unless two or more were taken away and two or more added in one place, when which became which cannot be told), beside any group that changed in the same write, so a move or a group added between others says where it went, since the card's order decides which group a price names when two price a vendor alike; a value keeps its line breaks, so a vendor note or an Update info answer of several lines reads as the drawer shows it)
   - "e2e@example.com set Ana Rivera to Approved"
   - "e2e@example.com undid their verdict on Ana Rivera: Rejected back to Open" (its giver taking it back within the window, an entry after the verdict's, E38/F10/S01)
   - "e2e@example.com changed Ana Rivera from Approved to Rejected" (a verdict already given, changed, E38/F06/S01)
   - "e2e@example.com moved the market from Review to Assignment" (a phase named as that market's other screens name it: its one stage is "Review" on a Google Form market and "Applications" on one whose vendors apply on its page)
   - "e2e@example.com stopped taking applications" and "e2e@example.com took applications again"
   - A vendor added by hand reads "e2e@example.com added Walk-in Wares as a vendor", opening to the name and status given and then each price answer under its question's label, in the form's order (the answers sit under `answers` in the detail, so a question keyed `name` or `status` never collides with them).
   - An organizer's update of a vendor's answers reads "e2e@example.com updated the info of Ana Rivera", and a save that only kept updates over answers the vendor changed since reads "e2e@example.com kept their update to the info of Ana Rivera", opening to each answer kept under its question's label as the form asks it, "Kept: Are you a student?", and under each a row "They wrote: Are you a student?" with what the vendor wrote that it was kept over, or "left it blank"; an entry from before that was recorded has the kept rows alone.
     An update taken away because the vendor's answer now matches it opens to "Their answer now matches: <the question's label>".
   - A possible Discord match declined reads "e2e@example.com said the Discord member @fern_studio_42 is not Ana Rivera", opening to the member, by username and the names that looked alike, and the username on file it was offered for ([possible matches](../../implementation/modules/discord.md#possible-matches)); one confirmed is the update of their info it saved.
   - "e2e@example.com assigned Ana Rivera at B7 (Full Table) on Nov 19, 2026"
   - A placement reads the same in [the assignment history](placing-by-hand.md#j13-assignment-history), which is this list, but for its day, which leads the entry there: a move names the table left and the table taken, "e2e@example.com moved Ana Rivera from A3 to B7 (Full Table) on Nov 19, 2026", and allocating tables reads "allocated tables: 40 assignments written, 3 pins preserved".
   - A vendor's money reads in the market's currency ([payments](../../implementation/data/payments.md)), each opening to its amount, how it was paid, the day and the note, or the amount owed, in the Payment tab's words:
     - "… seated Ana Rivera again on May 8, 2099, taking back the $0.00 set when the table was freed"
     - "e2e@example.com recorded a payment of $50.00 from Ana Rivera"
     - "… set what Ana Rivera owes on May 8, 2099 to $0.00" and "… back to the calculated price"
     - "… recorded a refund of $15.00 to Ana Rivera"
     - "… changed a payment from Ana Rivera"
     - "… removed a refund to Ana Rivera"
   - The door reads "e2e@example.com checked Ana Rivera in on Nov 19, 2026", a vendor's own check-in "Ana Rivera checked in with the door code on Nov 19, 2026" and its undo "Ana Rivera undid their check-in on their vendor page on Nov 19, 2026", and a door code "e2e@example.com made the door code", or "… made a new door code, which ended the old one and every poster of it", never naming the code ([the door on market day](market-day-door.md#k2-a-vendor-scans-the-door-code-and-is-checked-in)).
   - The Discord card reads "e2e@example.com connected the market to the Discord server “Riverside Makers”", "… disconnected the market from the Discord server “Riverside Makers”" and "… changed the Discord card: role and invite link", opening to the server's and the role's names and the username question's label, never Discord's ids or the question's key; a question the entry recorded without its label reads by the form's label, or as its key "(no longer on the form)".
   - "Check Discord" reads "e2e@example.com checked who is in the Discord server: 1 has the role, 2 in the server, 1 not found", opening to each vendor whose state it changed, before ("not checked" the first time) and after, and how many it found in each state ([the Discord connection](../../implementation/modules/discord.md#who-is-in-the-server)).
   - "Give roles" reads "e2e@example.com gave the Discord role “Vendor Nov 2026”: 2 given, 1 already had it, 1 not found", opening to each vendor it gave the role ("Given the role") or whose state it changed, before and after, and how many ended in each group ([giving the role](../../implementation/modules/discord.md#giving-the-role)).
   - "e2e@example.com changed priya@example.com from Viewer to Editor"
   - "e2e@example.com changed Check vendors in from Editor to Admin" (a row of the market's own permission table, named by its label)
   - "e2e@example.com set Check vendors in back to its default, Editor"
   - "e2e@example.com reset Check vendors in and Move the phase to their built-in defaults" (the whole table reset, naming each row it returned)
   - "e2e@example.com copied the organization's defaults, changing Check vendors in" (the organization's default copied again, naming each row it changed)
   - "Ana Rivera applied"
   - Both "applied" and an update of the info open to each answer under its question as the form asks it, in the form's order (the essential questions first, then the organizer's own), each read as the Application tab reads it, dates and tiers in words, the table-share question as one answer in the vendor's words, and an answer that reads the same on both sides left out.

   A change the screen has no sentence for yet reads through the deliberate fallback "made a change: <row label>, about <vendor>"; one whose action no row of the table names reads "made a change", never the action's id.

3. A vendor named in a change is a link to the market's Vendors page with their drawer open (`?vendor=`, [the vendor drawer](vendor-drawer.md)); the dialog closes as the page changes.
4. "Before and after" under a change opens a table of each field it changed, as it was and as it is, and what else it recorded (a count, a date, where it was made); a phase reads as that market's other screens name it, a status and a role as the screens name them, an essential question's answer as the review card shows it, under the question's label; the table-share answer reads as one row, in the vendor's own words ([an update is kept beside the vendor's answer](../rules/an-update-is-kept-beside-the-vendors-answer.md)), and where a permission row came from as "Built in", "The organization’s default" or "This market"; a reset of the whole table opens to each row it returned, and a copy of the organization's defaults to each row it changed, by its label, as its role and where it came from ("Admin, This market" to "Editor, Built in").
   The Field column is one width down the whole list, as wide as the widest name of any table open, a name counted at 12rem at most, the column, its padding and border included, at most a third of the table (a longer name wraps), so Before and After, halves of the rest, line up from one change to the next; a change whose every Before is "none" draws one column instead, "Answer" for an applicant's own answers and "After" for anything else, an arrival's reviewer included; an address breaks, where a column is too narrow for it, before its "@" or a dot, in the Field column as in the values, and a part still wider than the column then inside a word, never just after a hyphen and never running over the next column (T137 review note 7, T181); every address of the history is drawn by [`EmailAddress.vue`](../../../front-end/src/components/EmailAddress.vue) from [`addressParts.ts`](../../../front-end/src/utils/addressParts.ts)'s parts, so its accessible name keeps it one word ([`an-address-breaks-only-before-its-at.spec.ts`](../../../front-end/e2e/an-address-breaks-only-before-its-at.spec.ts)), and the review's warnings and reviewer lines ([dividing the review](review.md#dividing-the-review)) and Manage organization's rows ([its people](organizations.md#b2-add-an-admin-or-a-member)) draw theirs with it; a team of reviewers reads one address a line.
5. The box ([`PagedList`](../../../front-end/src/components/PagedList.vue), read through [`useHistoryPages`](../../../front-end/src/utils/useHistoryPages.ts)) is at most `min(28rem, 45dvh)` tall, so a short history is only as tall as it is, and a long one keeps the sections after it close.
   Its bar is hidden, as every scroller's is, and a shade at an edge says more lies beyond it.
   The next 25 arrive beneath the same entries as the end of the list comes into view, with nothing to press: scrolling or tabbing through the entries brings them, a page too short to fill the box leads on to the next, what was read stays put, an open "Before and after" stays open, and focus stays on its control.
   A list's end inside a box still below the dialog's fold is not in view, so it asks nothing until the dialog is scrolled to it, and a scroll past the end of the box carries on to the dialog.
   While a later page comes the list ends in "Loading…", which a screen reader hears.
   A first page that fails says so in its place, "The history could not be loaded." unless the failure says more, with "Try again", which reads it again ([`ReadFailed`](../../../front-end/src/components/ReadFailed.vue)).
   A later page that fails ends the list in what failed, "Older changes could not be loaded." unless the failure says more, and "Try again", which brings it and moves focus to the first control of what landed.
   A reader already at the end of the rows is shown that line, which lands below them; a reader still above the end keeps their place, and neither has their focus moved.
   There is no count of the entries, since a server page cannot know one cheaply, and no line for the list's end: the bottom shade going away says it.
   A change made in the dialog (a person given, changed or taken a role, a rename, a row of the permission table) reads the first page again, under the filters as they are, so it shows without reopening the dialog.
6. The filters above the list narrow it, and stay set while the dialog is open: "Who" (a field that finds anyone who changed something as an organizer by typing part of their address, "Anyone" first; its list lies over the filters below it, the arrow keys move, Enter takes, Escape closes the list before the dialog, and the words only search, so the list of changes stays narrowed as it was until another is taken), "Kind of change" (the table's groups: Market Setup, Applications, Lifecycle, Vendors, Assignment, Payments, The door, Discord, People; a seat filled again that takes back the $0 a free set reads under both Assignment and Payments), "Vendor" (a field that finds, by a name or part of an address, the market's vendors who gave a name and every address a loaded change names, each row the name beside the address ([`personChoice.ts`](../../../front-end/src/utils/personChoice.ts)) and at most 50 drawn before "N more, type to narrow"; its list lies over the filters below it and looks the same on every browser, the words narrow as they are typed and stay as typed on leaving unless they are a vendor's whole address or label, when the field names that vendor, one match narrows to that vendor, and choosing a row narrows to them and the field names them; while the words match several it says "2 vendors match. Keep typing, or choose one.", words that match nobody narrow the list to nothing, and an address typed whole that no loaded change names is asked for all the same), and "Changed from" and "Changed to" (when the change was made, calendar days in the reader's timezone, both kept).
   They stay above the box, and in a window about 800px tall or more they stay in sight beside the whole of it; a change of filter starts the list again from its newest entry, at the top of the box.
   "Clear filters" sets them all back; with nothing to show the list says "No change matches these filters.", or "Nothing has changed on this market yet." when unfiltered.

Someone below the row is shown no History section, and the server refuses them the read in the row's words.
Someone who may read it and never opens the section asks nothing of the server.
An archived market's history is still read: reading it is not a change ([an archived market is read-only](../rules/an-archived-market-is-read-only.md)).

## One vendor's history

A vendor's drawer reads the same history narrowed to that vendor on its History tab: the same component given the vendor, so the same sentences, "Before and after" and paging, with no filters, and the vendor named by name alone ([the vendor drawer](vendor-drawer.md)).
The list has no box of its own there: its entries scroll with the drawer's body, and the next 25 arrive as their end comes into view.
There, on the Vendors page, another vendor a change names opens in the same drawer, as the page's own vendor would, rather than following the link, so one Back still closes the drawer (E38/F13/S01); on any other page, and opened in a new tab, it is the link to Vendors.
A deal of many applications ([the review is dealt among chosen reviewers](../rules/the-review-is-dealt-among-chosen-reviewers.md)) reads there as that vendor's own line, "dealt the application to <address>", and opens to their reviewer alone, before and after; in the market's History it reads "chose the reviewers: …", "changed the reviewers: added …, removed …" or "removed every reviewer", and "dealt N open applications among M reviewers", or "dealt the application of <vendor> to <address>" when it moved one, and a removed reviewer's follow-up "dealt the follow-up of <vendor> from <address> to <address>"; a verdict on someone else's share ends ", dealt to <address>", and in a selection's sentence each such vendor is followed by "(dealt to <address>)"; an applicant's own arrival reads "The application of <vendor> was dealt to <address> as it arrived", in their drawer "The application was dealt to <address> as it arrived".
A Discord check reads there as that vendor's own line, "checked who is in the Discord server: Not found", and opens to their state alone, before and after; a check that left their state as it was names them not, and is not in their list.
A "Give roles" run reads "gave the Discord role “Vendor Nov 2026”" in the drawer of a vendor it gave the role, and "… to the assigned vendors: Not found" in that of a vendor whose state it changed otherwise.
The server narrows it to the changes that name the vendor, so a run of the assignment, which names nobody, is in no vendor's list.
Someone below the row is shown no History tab, as no History section.

"Assignment history" on the Assignments page reads the same history narrowed to the Assignment kind of change ([J13](placing-by-hand.md#j13-assignment-history)): the same component, in [`AssignmentHistoryDialog.vue`](../../../front-end/src/components/AssignmentHistoryDialog.vue), asking `group=Assignment` on every read, so the same sentences, in the same order, "Before and after" and paging.
It draws no "Kind of change", and that kind does not count as a filter, so "Clear filters" shows only once another filter is set; with nothing filtered and nothing there it says "No assignments have been changed yet."
"Market day" stands first among its filters: "Every market day", then each of the plan's days, opened on the date the Assignments page is showing when the plan holds it, and asking `day=` so a change about another day is left out while allocating tables and the assignment rules, about no one day, stay.
On a phone "Market day" and "Who" each take a row, since "Every market day" does not fit half of that dialog.
It counts as a filter, so "Clear filters" lets it go, and a day with nothing says "No change matches these filters."
The market day leads each entry there, on a line above its sentence, or "Every market day" on a run and on the rules, and the sentence does not say it again; everywhere else the day stays after the sentence, with no such line.
The list has no box of its own there either: the dialog's body is the one scroller, and the filters scroll away with it.
A vendor's name leads to the Vendors page with their drawer open, as in Manage market.

## The rules it obeys

- [What each role may do](../rules/what-each-role-may-do.md): the row "Read the market's history".
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md): it still reads.

Covered by:

- `a-verdict-names-whom-it-was-dealt-to.spec.ts`
- `assignmentHistory.test.ts` for the Assignment history's filters, the paging and the words
- `manageMarketHistory.test.ts` for the filters, the paging and the words
- `marketHistory.test.ts` for the filters, the paging and the words
- `people-at-scale-market.spec.ts` for "Who", at a desk and at 390 and 320 wide
- [`the-assignment-history.spec.ts`](../../../front-end/e2e/the-assignment-history.spec.ts)
- [`the-markets-history.spec.ts`](../../../front-end/e2e/the-markets-history.spec.ts)
- `the-vendors-history.spec.ts` for one vendor's
- `theDrawersHistory.test.ts` for the filters, the paging and the words

Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
