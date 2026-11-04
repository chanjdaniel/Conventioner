---
layer: business
kind: flow
describes:
  - front-end/src/components/PlacementDialog.vue
  - front-end/src/components/SearchPicker.vue
verified: 2026-11-04
sources:
  - brain-dump/2026-10-19#30
  - wayfinding/claims-and-room/05
  - wayfinding/readable-journey/08
  - wayfinding/rejection-visibility/02
  - E11/F02/S01
  - E11/F03/S01
  - E11/F04/S01
  - E40/F01/S04
  - E26/F05/S03
  - E35/F01/S02
  - E35/F03/S03
  - E36/F02
  - bug/1
  - bug/18
  - bug/31
  - bug/32
  - E36/F03/S01
  - E38/F08/S03
  - E38/F09/S01
  - E44/F01/S02
  - T142
  - T208
---

# Placing by hand

**Who:** the market's Editor, Admin or owner; a Viewer reads every seat and changes none ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Assignments page, in Assignment or Market Days; on an archived market every seat is a record.
**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

Every seat on the Assignments page is a control: a free seat opens the placement dialog to place someone ([`PlacementDialog.vue`](../../../front-end/src/components/PlacementDialog.vue)), and a held seat shows its occupant's name, a link at rest, which opens the [vendor drawer](vendor-drawer.md), and "Change" in its corner, which opens the dialog on that seat.
"Change" shows at rest, not on hover, since it is the only way to a held seat's dialog and a touch has no hover; a seat on a market that can no longer change loses its box and its "Change", and a held one's name still opens the drawer.
Before a run the tables are drawn already, so a seat can be given first: "Anyone you assign below first keeps their table: allocating tables assigns everyone else around them."
A hand placement warns about every answer it overrides and never blocks on one; what it may not do is seat someone with no application, or two people in one seat ([a seat only for an applicant](../rules/a-seat-only-for-an-applicant.md)).
**Every answer a hand change can cross is said before it is made, and the list is grouped, never filtered**, so overriding an answer is always one pick away; a search narrows each group and hides none.
The two ceilings are separate sentences because they are separate promises: "This gives them 2 dates; they asked for at most 1." is the vendor's own answer, "…the market allows at most 1 per vendor." the organizer's rule for everyone.
A tier is warned only on a date the vendor offered, since a date they never offered carries no tier answer; a swap or a move warns each vendor only about the new seat's tier and size, because changing tables on one date never changes whether they are there or how many dates they hold.
A vendor fits a seat when placing them overrides nothing, and a sharing vendor fits a wholly free table, since the organizer can give them half of it.
The dialog's lists are searched by typing ([`SearchPicker.vue`](../../../front-end/src/components/SearchPicker.vue), E38/F08/S03): part of a name, a business or an address narrows its two vendor lists, by the same terms as the Assignments page's search, and "Swap them with" and "Seated elsewhere today" by the table the vendor sits at too, its code or its section; "Move them to" finds an empty seat by its table code, its section, its location or its tier (T208).
The keyboard works them alone: the arrow keys move through the list, Enter takes the active choice, Escape closes the list and leaves the dialog open.
None of them passes the picker's `cap`, so each draws every choice it finds.
The dialog is the wide size, since a real name and address with a table and a side did not fit the standard one.
On a phone the page and the dialog fit the window (T142): a held seat's "Change", each "What to do with them" choice and each "Which seat" choice are thumb's targets, and the dialog's buttons wrap onto a second row where three do not fit on one.

Every change goes through [the one writer of placements](../../implementation/modules/placements.md), and each is recorded in [the market's history](../../implementation/data/history.md).

## J6. Place a vendor in an empty seat

**Status:** Works (walked live; who is offered read from the code as of E36/F02/S02, `placing-someone-not-approved.spec.ts`); check-in sends the vendor to the seat placed (bug 1, [K2](market-day-door.md#k2-a-vendor-scans-the-door-code-and-is-checked-in)).

1. Click a free seat ("Assign someone" shows on the pointer); the dialog is titled with the table, and names the date, section and tier.
2. "Who sits here" ("Search by name, business or email…"), grouped as "Fits this seat", "Would override their answers", "Not approved" and "Added by hand"; every applicant without a table on that date is offered; typing narrows each group, and one with nobody matching says "None match", and "Every vendor who applied already has a table on this date." when none is left.
   A last group, "Seated elsewhere today (moves them)", offers everyone seated at another table that date, which is a move ([J19](#j19-move-a-vendor-to-an-empty-seat)).
3. For a half table with both halves free, "Which seat": left or right.
4. Warnings name what the placement overrides: not available that date, asked for a whole table, a tier they did not accept ("…which sets their price."), their own date limit or the market's, and "Not approved: rejected." for someone not approved.
5. "Assign them here", which reads "Move them here" for someone chosen from "Seated elsewhere today".

A seat already taken is refused, naming its holder: "<email> already holds <table> (<size>) on <date>. Free that seat first, or swap the two vendors." (bug 32).
A seat held by someone not approved is marked "Not approved" on the Assignments page and in the drawer, and the next run keeps them there.
Covered by:
- `adding-a-vendor.spec.ts`
- `override-warnings.spec.ts`
- `placement-edit.spec.ts`
- `placing-someone-not-approved.spec.ts`

## J7. Swap two vendors

**Status:** Works (walked live; the seat's Change and View vendor read from the code as of E35/F01/S02; the action choice as of T208).
"Change" on an occupied seat: "<name> holds this seat.", with "View vendor" beside it, which closes the dialog and opens the [drawer](vendor-drawer.md).
"What to do with them" offers the taken seat's two actions, "Move to an empty seat" ([J19](#j19-move-a-vendor-to-an-empty-seat)) and "Swap with someone seated", the swap chosen already when no seat is empty that date; changing the action clears the other's choice.
Swapping: "Swap them with" ("Search by name, business, email or table…") any other vendor seated that date, each named with where they sit, found by typing; "Swap seats"; both seats change at once.
"Nobody else holds a table on this date, so there is nobody to trade with." when nobody else is seated.
The same warnings as J6 apply to both vendors, including a change of table size (bugs 18 and 32).
Covered by:
- `a-searchable-vendor-picker.spec.ts`
- `a-seat-and-an-entry-open-the-drawer.spec.ts`
- `override-warnings.spec.ts`
- `placement-edit.spec.ts`

## J19. Move a vendor to an empty seat

**Status:** Works from either end, the vendor's seat or the empty one (T208, `moving-a-vendor-to-an-empty-seat.spec.ts`).
A move is one action, one write, so the vendor never stands at no table between freeing one seat and filling another.

From the vendor's seat:

1. "Change" on the vendor's seat; "What to do with them" starts at "Move to an empty seat" when that date has an empty seat.
2. "Move them to" ("Search by table, section or tier…") lists every empty seat that date, whatever the page's filters show, the vendor's own table left out: one group per section in the plan's order, headed with the section and its tier ("Landing, Silver"), each table naming its free part ("The whole table", "The left half", "The right half").
   "Every table is taken on this date, so there is nowhere empty to move them." when there is none.
3. A wholly free table offers "Which seat", starting at the shape the vendor holds now: a whole table stays whole, a half stays a half, on the left; a half-taken table states its free side, "The right half - the other side is taken.".
4. Warnings name what the new seat overrides of their answers, its tier and its size only, never a date or a ceiling.
5. "Move them", disabled until a seat is chosen; Enter runs it through the same guard, and never reaches "Free this seat".

From the empty seat:

1. Click the free seat; "Who sits here" ends with "Seated elsewhere today (moves them)": everyone seated at another table that date, whoever seated them, anyone at this table left out, each naming the table they would leave ("Leaves North Wing 1, a whole table").
   Typing finds them by name, business or address, or by that table's code or section.
   "Every vendor who applied already has a table on this date. Choosing one moves them here." when nobody is left without a table but someone sits elsewhere.
2. Choosing one starts "Which seat", at a wholly free table, at the shape they hold now, as above, and warns only about this seat's tier and size.
3. "Move them here", where any other choice reads "Assign them here".

The vendor sits at the new table and their old seat is free, through the one write that places a vendor on a date ([placements](../../implementation/modules/placements.md)); the history records it as one entry, "Moved <vendor> from North Wing 1 to Landing 2 (Full Table)" ([J13](#j13-assignment-history)), and the day's line of what they owe follows the new table's price, unless an Admin set the amount by hand ([a price follows the table](../rules/a-price-follows-the-table.md)).
A seat taken by someone else meanwhile is refused with the server's reason in the dialog, which stays open to choose again.
Any change to the tables, a placement, a move, a swap, a free or a run, that lands while someone else's change to them is being saved is refused, and none of it is saved: "Someone else changed this market's tables while this change was being saved, so it was not saved. Reload the tables and try again." ([placements](../../implementation/modules/placements.md)).
The page does not read the tables again by itself, so reloading shows what the other change did.
Covered by:
- `moving-a-vendor-to-an-empty-seat.spec.ts`
- `placement-edit.spec.ts`

## J8. Free a seat

**Status:** Works (walked live).
In the same dialog, "Free this seat" ("Freeing this seat leaves them with no table on this date until they are assigned again.").
Freeing never changes what they owe by itself: the day keeps its line on their [Payment tab](vendor-drawer.md), still owed.
Whoever may change the amount owed is also asked, naming what the day's line owes, "Also remove its $15.00 from what Alice owes? (Cancelled before the deadline: a refund may be due.)", unticked, and not asked where it owes nothing; ticked, the day owes $0 once freed, so a vendor who paid reads paid more than owed (E44/F01/S02).
Covered by:
- `changing-owed-and-paid.spec.ts`
- `placement-edit.spec.ts`

## J9. Allocate tables again, keeping hand assignments

**Status:** Works (walked live).
Every hand assignment is a pin; on the Settings page, "Allocate tables again" says "Keeps your N hand assignments; allocates tables for everyone else again." (or "Allocates tables for everyone again." with none) and seats pins first.
Covered by:
- `placement-pins.spec.ts`
- `placing-someone-not-approved.spec.ts`

## J10. A pin the plan no longer holds

**Status:** Works (`placement-pins.spec.ts`, `orphaned-pin-in-assignment.spec.ts`; bug 31).
A pin whose seat the plan no longer has is orphaned, never deleted.
The setup settles on leaving Draft ([the setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md)), so a pin is orphaned only by changing a settled plan in the database, as these specs do.
It blocks Begin assignment ([I5](review.md#i5-begin-assignment)) until moved or freed.
In Assignment its table is marked "No longer in the plan - move or free this vendor", the vendor's drawer says "This table is no longer in the plan. Move them or free the seat before publishing.", and Publish market is refused until it is re-placed or freed.
Covered by:
- `orphaned-pin-in-assignment.spec.ts`
- `placement-pins.spec.ts`

## J13. Assignment history

**Status:** Works (walked live; the button and the names read from the code as of E35/F03/S03, `the-placement-history-dialog.spec.ts`; the drawer's tab as of E40/F01/S04, `the-vendors-history.spec.ts`).
"Assignment history" on the Assignments page opens the market's assignment history in full.
A vendor's drawer holds their placements on its History tab, among everything else [the market's history](reading-the-markets-history.md) holds about them, each led by who made it and followed by the day it is for ([the vendor drawer](vendor-drawer.md)).
Each entry says what changed, naming each vendor by name with their email beside, who made it and when: "Assigned <vendor> at Front 10 (Full Table)" (the table alone where no table choice was recorded), "Moved <vendor> from Back 1 to Front 10 (Full Table)" when they had a table that day, "Swapped <vendor> and <vendor> - now at Front 10 and Back 1", "Freed Back 1, leaving <vendor> with no table"; a solver run is one entry, "Allocated tables: N assignments written, M pins preserved", and names nobody, so it is in no vendor's tab.
A move recorded before the history kept the table left reads as an assignment.
Anyone who may read the market's history can read it, and the drawer holds no History tab for anyone else ([what each role may do](../rules/what-each-role-may-do.md)).
Covered by:
- `the-placement-history-dialog.spec.ts`
- `the-vendors-history.spec.ts`

## The rules it obeys

- [A seat only for an applicant](../rules/a-seat-only-for-an-applicant.md): anyone who applied may be seated, warned, and is held.
- [Adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md): the "Added by hand" group.
- [Tier filters, section prefers](../rules/tier-filters-section-prefers.md): a tier they did not accept is warned about, since it sets their price.
- [An assignment knows when it is out of date](../rules/an-assignment-knows-when-it-is-out-of-date.md): a hand placement is not a change.
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md).

Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).

## Superseded

- A searchable picker was weighed for a market of two hundred and not taken, since a native select jumps to a name as it is typed (wayfinding/claims-and-room/05); both lists are searched by typing, by name, business, address and table (E38/F08/S03).
