---
layer: business
kind: flow
describes:
  - front-end/src/components/PlacementDialog.vue
verified: 2026-10-30
sources:
  - brain-dump/2026-10-19#30
  - wayfinding/claims-and-room/05
  - wayfinding/readable-journey/08
  - wayfinding/rejection-visibility/02
  - E11/F02/S01
  - E11/F03/S01
  - E11/F04/S01
  - E26/F05/S03
  - E35/F01/S02
  - E35/F03/S03
  - E36/F02
  - bug/1
  - bug/18
  - bug/31
  - bug/32
  - E36/F03/S01
---

# Placing by hand

**Who:** the market's Editor, Admin or owner; a Viewer reads every seat and changes none ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Result page, in Assignment or Market Days; on an archived market every seat is a record.
**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

Every seat on the Result page is a control: a free seat opens the placement dialog to place someone ([`PlacementDialog.vue`](../../../front-end/src/components/PlacementDialog.vue)), and a held seat shows its occupant's name, which opens the [vendor drawer](vendor-drawer.md), and "Change" in its corner, which opens the dialog on that seat.
"Change" shows at rest, not on hover, since it is the only way to a held seat's dialog and a touch has no hover; a seat on a market that can no longer change draws as text, with nothing to press.
Before a run the tables are drawn already, so a seat can be given first: "Anyone you assign below first keeps their table: allocating tables assigns everyone else around them."
A hand placement warns about every answer it overrides and never blocks on one; what it may not do is seat someone with no application, or two people in one seat ([a seat only for an applicant](../rules/a-seat-only-for-an-applicant.md)).
**Every answer a hand change can cross is said before it is made, and the list is grouped, never filtered**, so overriding an answer is always one pick away.
The two ceilings are separate sentences because they are separate promises: "This gives them 2 dates; they asked for at most 1." is the vendor's own answer, "…the market allows at most 1 per vendor." the organizer's rule for everyone.
A tier is warned only on a date the vendor offered, since a date they never offered carries no tier answer; a swap warns each vendor only about the seat's tier and size, because trading tables on one date never changes whether they are there or how many dates they hold.
A vendor fits a seat when placing them overrides nothing, and a sharing vendor fits a wholly free table, since the organizer can give them half of it.
A searchable picker was weighed for a market of two hundred and not taken: the product has no such shared control, and a native select already jumps to a name as it is typed.
The dialog is the wide size, since a real name and address with a table and a side did not fit the standard one.

Every change goes through [the one writer of placements](../../implementation/modules/placements.md), and each is recorded in [the market's history](../../implementation/data/history.md).

## J6. Place a vendor in an empty seat

**Status:** Works (walked live; who is offered read from the code as of E36/F02/S02, `placing-someone-not-approved.spec.ts`); check-in sends the vendor to the seat placed (bug 1, [K2](market-day-door.md#k2-a-vendor-looks-up-their-table-and-checks-in)).

1. Click a free seat ("Assign someone" shows on the pointer); the dialog is titled with the table, and names the date, section and tier.
2. "Who sits here": "Choose a vendor…", grouped as "Fits this seat", "Would override their answers", "Not approved" and "Added by hand"; every applicant without a table on that date is offered, and "Every vendor who applied already has a table on this date." when none is left.
3. For a half table with both halves free, "Which seat": left or right.
4. Warnings name what the placement overrides: not available that date, asked for a whole table, a tier they did not accept ("…which sets their price."), their own date limit or the market's, and "Not approved: rejected." for someone not approved.
5. "Assign them here".

A seat already taken is refused, naming its holder: "<email> already holds <table> (<size>) on <date>. Free that seat first, or swap the two vendors." (bug 32).
A seat held by someone not approved is marked "Not approved" on the Result page and in the drawer, and the next run keeps them there.
Covered by: `placement-edit.spec.ts`, `override-warnings.spec.ts`, `placing-someone-not-approved.spec.ts`.

## J7. Swap two vendors

**Status:** Works (walked live; the seat's Change and View vendor read from the code as of E35/F01/S02).
"Change" on an occupied seat: "<name> holds this seat.", with "View vendor" beside it, which closes the dialog and opens the [drawer](vendor-drawer.md); "Swap them with" ("Choose a vendor to trade seats with…") any vendor seated that date, each named with where they sit; "Swap seats"; both seats change at once.
"Nobody else holds a table on this date, so there is nobody to trade with." when nobody else is seated.
The same warnings as J6 apply to both vendors, including a change of table size (bugs 18 and 32).
Covered by: `placement-edit.spec.ts`, `override-warnings.spec.ts`, `a-seat-and-an-entry-open-the-drawer.spec.ts`.

## J8. Free a seat

**Status:** Works (walked live).
In the same dialog, "Free this seat" ("Freeing this seat leaves them with no table on this date until they are assigned again.").
Covered by: `placement-edit.spec.ts`.

## J9. Allocate tables again, keeping hand assignments

**Status:** Works (walked live).
Every hand assignment is a pin; on Assignment, "Allocate tables again" says "Keeps your N hand assignments; allocates tables for everyone else again." (or "Allocates tables for everyone again." with none) and seats pins first.
Covered by: `placement-pins.spec.ts`, `placing-someone-not-approved.spec.ts`.

## J10. A pin the plan no longer holds

**Status:** Works (`placement-pins.spec.ts`, `orphaned-pin-in-assignment.spec.ts`; bug 31).
A pin whose seat the plan no longer has is orphaned, never deleted.
The setup settles on leaving Draft ([the setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md)), so a pin is orphaned only by changing a settled plan in the database, as these specs do.
It blocks Begin Assignment ([I5](review.md#i5-begin-assignment)) until moved or freed.
In Assignment its table is marked "No longer in the plan - move or free this vendor", the vendor's drawer says "This table is no longer in the plan. Move them or free the seat before publishing.", and Publish Market is refused until it is re-placed or freed.
Covered by: `placement-pins.spec.ts`, `orphaned-pin-in-assignment.spec.ts`.

## J13. Assignment history

**Status:** Works (walked live; the button and the names read from the code as of E35/F03/S03, `the-placement-history-dialog.spec.ts`).
"Assignment history" on the Result page opens the market's assignment history in full, and a vendor's drawer has their own on its History tab.
Each entry says what changed, naming each vendor by name with their email beside, who made it and when: "Assigned <vendor> at Front 10 (Full Table)", "Swapped <vendor> and <vendor> - now at Front 10 and Back 1", "Freed Back 1, leaving <vendor> with no table"; a solver run is one entry, "Allocated tables: N assignments written, M pins preserved".
Anyone who may read the market's history can read it ([what each role may do](../rules/what-each-role-may-do.md)).
Covered by: `the-placement-history-dialog.spec.ts`.

## The rules it obeys

- [A seat only for an applicant](../rules/a-seat-only-for-an-applicant.md): anyone who applied may be seated, warned, and is held.
- [Adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md): the "Added by hand" group.
- [Tier filters, section prefers](../rules/tier-filters-section-prefers.md): a tier they did not accept is warned about, since it sets their price.
- [An assignment knows when it is out of date](../rules/an-assignment-knows-when-it-is-out-of-date.md): a hand placement is not a change.
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md).

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
