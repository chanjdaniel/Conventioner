---
layer: business
kind: flow
describes:
  - front-end/src/components/PlacementDialog.vue
verified: 2026-10-22
sources:
  - E11/F02/S01
  - E11/F03/S01
  - E11/F04/S01
  - E35/F01/S02
  - E35/F03/S03
  - E36/F02
  - bug/1
  - bug/18
  - bug/31
  - bug/32
---

# Placing by hand

**Who:** the market's Editor, Admin or owner; a Viewer reads every seat and changes none ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Result page, in Assignment or Market Days; on an archived market every seat is a record.

Every seat on the Result page is a control: a free seat opens the placement dialog to place someone ([`PlacementDialog.vue`](../../../front-end/src/components/PlacementDialog.vue)), and a held seat shows its occupant's name, which opens the [vendor drawer](vendor-drawer.md), and "Change" in its corner, which opens the dialog on that seat.
Before a run the tables are drawn already, so a seat can be given first: "Anyone you place below first keeps their table: the run places everyone else around them."
A hand placement warns about every answer it overrides and never blocks on one; what it may not do is seat someone with no application, or two people in one seat ([a seat only for an applicant](../rules/a-seat-only-for-an-applicant.md)).
Every change goes through [the one writer of placements](../../implementation/modules/placements.md), and each is recorded in [the placement history](../../implementation/data/placement-history.md).

## J6. Place a vendor in an empty seat

**Status:** Works (walked live; who is offered read from the code as of E36/F02/S02, `placing-someone-not-approved.spec.ts`); check-in sends the vendor to the seat placed (bug 1, [K2](market-day-door.md#k2-a-vendor-looks-up-their-table-and-checks-in)).

1. Click a free seat ("Place someone" shows on the pointer); the dialog is titled with the table, and names the date, section and tier.
2. "Who sits here": "Choose a vendor…", grouped as "Fits this seat", "Would override their answers", "Not approved" and "Added by hand"; every applicant without a table on that date is offered, and "Every vendor who applied already has a table on this date." when none is left.
3. For a half table with both halves free, "Which seat": left or right.
4. Warnings name what the placement overrides: not available that date, asked for a whole table, a tier they did not accept ("…which sets their price."), their own date limit or the market's, and "Not approved: rejected." for someone not approved.
5. "Place them here".

A seat already taken is refused, naming its holder: "<email> already holds <table> (<size>) on <date>. Free that seat first, or swap the two vendors." (bug 32).
A seat held by someone not approved is marked "Not approved" on the Result page and in the drawer, and the next run keeps them there.
Covered by: `placement-edit.spec.ts`, `override-warnings.spec.ts`, `placing-someone-not-approved.spec.ts`.

## J7. Swap two vendors

**Status:** Works (walked live; the seat's Change and View vendor read from the code as of E35/F01/S02).
"Change" on an occupied seat: "<name> holds this seat.", with "View vendor" beside it; "Swap them with" ("Choose a vendor to trade seats with…") any vendor seated that date, each named with where they sit; "Swap seats"; both seats change at once.
"Nobody else holds a table on this date, so there is nobody to trade with." when nobody else is seated.
The same warnings as J6 apply to both vendors, including a change of table size (bugs 18 and 32).
Covered by: `placement-edit.spec.ts`, `override-warnings.spec.ts`, `a-seat-and-an-entry-open-the-drawer.spec.ts`.

## J8. Free a seat

**Status:** Works (walked live).
In the same dialog, "Free this seat" ("Freeing this seat leaves them with no table on this date until they are placed again.").
Covered by: `placement-edit.spec.ts`.

## J9. Run again, keeping hand placements

**Status:** Works (walked live).
Every hand placement is a pin; on Assignment, "Run again" says "Keeps your N hand placements; places everyone else again." (or "Places everyone again." with none) and seats pins first.
Covered by: `placement-pins.spec.ts`, `placing-someone-not-approved.spec.ts`.

## J10. A pin the plan no longer holds

**Status:** Works (`placement-pins.spec.ts`, `orphaned-pin-in-assignment.spec.ts`; bug 31).
A pin whose seat the plan no longer has is orphaned, never deleted.
The setup settles on leaving Draft ([the setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md)), so a pin is orphaned only by changing a settled plan in the database, as these specs do.
It blocks Begin Assignment ([I5](review.md#i5-begin-assignment)) until moved or freed.
In Assignment its table is marked "No longer in the plan - move or free this vendor", the vendor's drawer says "This table is no longer in the plan. Move them or free the seat before publishing.", and Publish Market is refused until it is re-placed or freed.
Covered by: `placement-pins.spec.ts`, `orphaned-pin-in-assignment.spec.ts`.

## J13. Placement history

**Status:** Works (walked live; the button and the names read from the code as of E35/F03/S03, `the-placement-history-dialog.spec.ts`).
"Placement history" on the Result page opens the market's whole history, and a vendor's drawer has their own on its History tab.
Each entry says what changed, naming each vendor by name with their email beside, who made it and when: "Placed <vendor> at Front 10 (Full Table)", "Swapped <vendor> and <vendor> - now at Front 10 and Back 1", "Freed Back 1, leaving <vendor> with no table"; a solver run is one entry, "Ran the assignment: N placements written, M pins preserved".
Anyone who can read the market can read it.
Covered by: `the-placement-history-dialog.spec.ts`.

## The rules it obeys

- [A seat only for an applicant](../rules/a-seat-only-for-an-applicant.md): anyone who applied may be seated, warned, and is held.
- [Adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md): the "Added by hand" group.
- [Tier filters, section prefers](../rules/tier-filters-section-prefers.md): a tier they did not accept is warned about, since it sets their price.
- [An assignment knows when it is out of date](../rules/an-assignment-knows-when-it-is-out-of-date.md): a hand placement is not a change.
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md).

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
