---
layer: business
kind: flow
describes:
  - front-end/src/components/VendorDrawer.vue
  - front-end/src/utils/vendorDrawer.ts
verified: 2026-10-31
sources:
  - brain-dump/2026-10-19#13
  - brain-dump/2026-10-19#14
  - brain-dump/2026-10-19#15
  - brain-dump/2026-10-19#16
  - brain-dump/2026-10-19#25
  - brain-dump/2026-10-19#30
  - E31/F04/S04
  - E34/F04/S01
  - E35/F01
  - E35/F02/S02
  - E36/F02/S03
  - E36/F03/S01
  - E35/F01/S01
  - E35/F01/S02
  - E43/F01/S01
  - E41/F01/S01
  - E41/F01/S02
  - E40/F01/S04
  - E38/F06/S01
  - E38/F07/S02
  - T123
  - T139
  - E44/F01/S01
  - E44/F01/S02
---

# The vendor drawer

**Who:** anyone who can read the market; notes, placing and recording a payment are an Editor's, and a market that is read-only shows them without the controls ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** wherever a vendor appears: a row on the Vendors page ([J11](vendors.md#j11-browse-by-vendor)), a name on a seat or "View vendor" in the placement dialog ([J7](placing-by-hand.md#j7-swap-two-vendors)), a name on Attendance ([K5](market-day-door.md#k5-watch-attendance)), and a row of the review's All view ([the All view](review.md#the-all-view)).
**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md), [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md) and [The door on market day](../intents/the-door-on-market-day.md).

One drawer opens over the page from the side, the same on every one of those pages ([`VendorDrawer.vue`](../../../front-end/src/components/VendorDrawer.vue)).
The open vendor and tab are kept in the address (`?vendor=<email>&vendorTab=assignments`), so a reload or a shared link opens the same drawer ([`vendorDrawer.ts`](../../../front-end/src/utils/vendorDrawer.ts)).

**Status:** Works (read from the code as of E35/F01: `the-vendor-drawer.spec.ts`, `a-seat-and-an-entry-open-the-drawer.spec.ts`; the History tab as of E40/F01/S04, `the-vendors-history.spec.ts`).

1. Click a vendor where they appear; the drawer opens on its Application tab, wherever it was opened, and the page behind it holds still and cannot be reached.
2. The head, "Vendor detail": the vendor's name, their address beside it when they have a name, and their verdict with who gave it ("Approved by <email>, <date and time>"), or "Added by <email>, …" for a vendor added by hand.
   Opened from the review's All view, the application's status sits under the head, with whose share it is while reviewers are chosen and who holds it open, and Reject, Needs follow-up and Approve beside it while the review is open, under a warning when it is dealt to another reviewer ([the All view](review.md#the-all-view)); everywhere else the verdict and its giver only read.
   On an application already approved or rejected those are a change, offered only to someone the row "Change a verdict, or overturn an automatic rejection" lets change one, and a reviewer it refuses reads its sentence in their place (E38/F06/S01).
   The drawer offers verdicts on the server's answers, the verdicts row's, the change row's and `verdictsSettledReason`, never on a list of phases of its own, so it and the review cannot disagree.
3. The vendor's notes, pinned above the tabs and shown on every one: their request ("Request", or "Request handled" once ticked), "Your note", and "From your sheet" for a note an import brought in; a vendor with no notes on a read-only market shows none.
4. Four tabs, moved between with the arrow keys; History is held only for whoever the row "Read the market's history" allows, and an address asking for it opens on Application for anyone else:
   - **Application:** a table-share request that needs attention, then "Submission", the vendor's answers ("This market asks no questions of its own." when it asks none).
     An answer an organizer updated reads as updated, with "Updated by <address>, <when>; they wrote <their answer>" under it, and "Their answer changed since your update." once a re-import or their own edit changed what they wrote.
     "Update info", at the end of the Submission heading for whoever the row "Update a vendor's info" allows, opens a dialog of their answers, each in its question's own control, with Save and Cancel: an answer that differs from what they wrote shows it beside it, with "Use their answer"; below them the essential questions, as the form asks them; those the assignment reads, and the market's own questions a price group reads, are read-only to whoever the row "Update info the assignment or price reads" refuses ([an update is kept beside the vendor's answer](../rules/an-update-is-kept-beside-the-vendors-answer.md)).
     Escape closes the dialog alone; once it saves, the drawer reads the market's vendors again, which the Vendors list shares, and the review's All view behind it reads its list again.
   - **Assignments:** one card per market date: where they sit, with "Change assignment", or why they were not placed ([J12](vendors.md#j12-find-out-why-a-vendor-was-not-placed)); a placement that overrides their answers or that the plan no longer holds says so.
     Where the market prices its tables, an assigned date says what the table costs that day, "Gold, full table, $35", or with the vendor's price group where the card has groups, "Gold, full table, Example College student + club member, $12" ([a price follows the table](../rules/a-price-follows-the-table.md)).
     "Change assignment" opens the Assignments page showing only that vendor's table on that date: it sets the date and searches for their whole address, which matches that vendor alone, rather than naming the vendor, which would open the drawer again over the table it was meant to show.
   - **Payment:** what they owe and what they paid ([payments](../../implementation/data/payments.md)), for the organizers alone (Q20.2).
     Both totals head it, "Owed" and "Paid", with how the two compare: "Owes $27", "Paid in full", "Paid $15 more than owed" (the case where a refund is to be issued by hand), or "Nothing owed".
     Then a line per table-day, its date, table, tier and size, and what is owed for it: the price of the seat they hold that day, following the seat when it moves; a market with no prices reads "No price".
     A day whose table was freed keeps its line, still owed, and says so beside the seat it prices: "North Wing 1, Gold, full table - table freed Oct 30, 2026", so every number says where it came from; freeing a table changes neither amount by itself (Daniel, T92 Q26).
     Then each payment, the last recorded first: its amount, e-transfer or cash, the day it was paid, its note, and who recorded it and when.
     "Record payment", at the end of the Payments heading for whoever the row "Record a payment" allows, opens a dialog of the amount, e-transfer or cash, the day paid (today to begin with) and an optional note; once recorded, the tab reads the account the server answers.
     For whoever the row "Change the amount owed" allows, each line has a "..." menu: "Change the amount owed" opens a dialog that says the change before Save ("Friday, May 8, 2099 will owe $0 instead of $15."), $0 waiving it; a line set by hand shows the calculated price struck beside it, "Set by <address>, <when>", or "Removed when the table was freed, by <address>, <when>" for the $0 a free's deduction set, which seating the day again takes back, and its menu adds "Use the calculated price", confirmed first.
     For whoever the row "Adjust the amount paid" allows, "Record refund" sits beside "Record payment", for money given back ("-$15", "Refund by e-transfer, given …"), and each entry has a "..." menu: "Edit" opens the same dialog filled in, and "Remove", confirmed first, takes it out of what they paid and leaves it listed, struck; an edited or removed entry keeps "Recorded by …", with "Edited by …" or "Removed by …" under it ([payments](../../implementation/data/payments.md)).
   - **History:** everything [the market's history](reading-the-markets-history.md) holds about them, newest first, a page of ten at a time with "Load more": applying and editing their application, being added by hand, verdicts and follow-ups, the application dealt to a reviewer, notes, tables assigned, moved, swapped and freed ([J13](placing-by-hand.md#j13-assignment-history)), check-ins, their info updated, and their payments, refunds and amounts owed changed.
     Each entry reads as in Manage market's History section, opening to its before and after; the vendor reads by name alone, as text, since the head shows their address, and any other vendor an entry names links to their own drawer, by name and address.
     A run of the assignment names nobody, so it is not in a vendor's list.
     There are no filters: it is already one vendor's.
5. Close with "×", Escape, or a click outside it; the address loses the vendor.
   The drawer opens with focus on "×", and closing gives focus back to what opened it, a row, a name or a button ([dialogs](../../implementation/conventions/dialogs.md)).

On Attendance, opening the drawer never checks anyone in, and a first note added there appears under the vendor's row.
A market's vendors are read once, for the Vendors list and the drawer alike (`useVendorDetails` in [`front-end/src/utils/vendorDetails.ts`](../../../front-end/src/utils/vendorDetails.ts)): every application, decided or not, with its seats, reasons and overrides; a placement changed on the Assignments page reads them again.
The applications stand on their own read: when the server cannot say where vendors sit, the drawer still shows the answers, says the server's reason in red on every tab, and offers no date cards, and the Vendors list says nothing of who is placed ([J11](vendors.md#j11-browse-by-vendor)); every vendor keeps their name, read from their application (T123).
Covered by: `the-vendor-drawer.spec.ts`, `the-vendors-history.spec.ts`, `the-payment-tab.spec.ts`, `changing-owed-and-paid.spec.ts`, `a-seat-and-an-entry-open-the-drawer.spec.ts`, `change-placement-shows-the-table.spec.ts`, `the-all-view.spec.ts`, `changing-a-verdict-is-its-own-row.spec.ts`, `vendor-notes.spec.ts`, `updating-vendor-info.spec.ts`, `updating-answers-the-assignment-reads.spec.ts`, `vendors.spec.ts` ("while the vendor drawer is open, nothing behind it can be tabbed to"), `the-drawer-reads-the-application-when-the-tables-cannot.spec.ts`, `a-stored-assignment-reads-with-an-answer-missing.spec.ts`.

## The rules it obeys

- [A seat only for an applicant](../rules/a-seat-only-for-an-applicant.md): a seat held by someone not approved is marked here too.
- [Adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md): who added them, in place of a verdict.
- [Verdicts settle on entering assignment](../rules/verdicts-settle-on-entering-assignment.md): the All view's verdicts leave the drawer when the review closes.
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md).
- [Vendor notes](../rules/vendor-notes.md): the request, the note and the sheet's line, each under its own label.
- [An update is kept beside the vendor's answer](../rules/an-update-is-kept-beside-the-vendors-answer.md): "Update info", and what an updated answer says.

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
