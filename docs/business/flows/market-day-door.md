---
layer: business
kind: flow
describes:
  - front-end/src/views/AttendanceCheckinView.vue
  - front-end/src/views/AttendanceStatusView.vue
verified: 2026-10-22
sources:
  - E10/F01/S02
  - E15/F02/S04
  - E29
  - E30/F01/S02
  - E31/F03/S02
  - E32/F01/S01
  - E35/F01/S02
  - E36/F04/S02
  - bug/1
---

# Publishing, and the door on market day

**Who:** the market's Admin or owner publishes; an Editor checks vendors in at the door; a vendor, with no account, looks up their table and checks themselves in.
**Where they start:** the phase rail in Assignment; on the day, the organizer on the Attendance tab and the vendor at the check-in link the organizer shares.

Publishing puts the market's check-in page on the air; from then on the market is in Market Days, and the door is two pages over one roster of who is placed where: the vendor's own check-in page ([`AttendanceCheckinView.vue`](../../../front-end/src/views/AttendanceCheckinView.vue)) and the organizer's Attendance ([`AttendanceStatusView.vue`](../../../front-end/src/views/AttendanceStatusView.vue)).
Both read the stored assignment, so a vendor placed, swapped or freed by hand is sent where they were put; how the door works is [attendance and the door](../../implementation/modules/attendance-and-door.md).

## K1. Publish the market

**Status:** Works (re-walked live on 2026-10-03; its refusals, the landing and the tab read from the code as of E31/F03/S02, E32/F01/S01 and E36/F04/S02).
**Task:** "Your assignment is final. Make it live so vendors can find their tables."

1. Rail: "Publish Market", the main button in Assignment.
2. "Publish Market?": "Publishing puts this market's check-in page on the air: every vendor you placed can look themselves up and check in on the day. The assignment they see is the one you have now." and "A published market cannot be returned to an earlier phase."; focus starts on Cancel.
3. Expect Market Days, landing on Attendance, and "Check-in page" with its address and "Copy" in the rail; the rail says "Check vendors in at the door."

Disabled before the click, with the rail naming the first blocker:

- no assignment is stored: "No assignment has been computed for this market, so its check-in page could not tell anyone where to stand. Run the assignment first.", with "Run the assignment";
- a hand placement names a seat the plan no longer has ([J10](placing-by-hand.md#j10-a-pin-the-plan-no-longer-holds));
- on a market whose vendors apply on its page, the results are not published: "Applicants have not been told whether they have a table. Publish the results before the market goes live.", with "Publish results" ([I7](assignment-and-result.md#i7-publish-results)).

The Attendance tab is on the bar in every phase; before publishing it says "Opens when the market is published."
Covered by: `phase-rail.spec.ts`, `phase-state-machine.spec.ts`, `tier2.spec.ts` ("publish market and verify check-in URL"), `results-wait-for-the-allocation.spec.ts`.

## K2. A vendor looks up their table and checks in

**Status:** Works (re-walked live on 2026-10-03 on a phone-sized window; the cards read from the code as of E29 and the 2026-10-18 fixes, `checkin.spec.ts`).
**Task (vendor):** "You are at the market. Find your table and check in."

1. `/<market-slug>/check-in`, "Vendor check-in", names the market before anything is typed.
2. "Your email" ("Use the address you applied with."), "Look up".
3. Expect their name with the address it matched beside it, then one card per date they are placed, in date order: Table (in words, with its size), Section, Tier, Location; today's card is marked "Today".
4. "Check in" on today's card; expect "Checked in ✓ <time>" and "Undo".

The cards show the stored assignment, so a vendor placed, swapped or freed by hand is sent where they were put (bug 1).
An address that is not a published market's says "There is no check-in page at this address. Check the link you were given, or ask the market's organizer."
Covered by: `checkin.spec.ts`.

## K3. Check in on a day that is not today

**Status:** Works (read from the code since the 2026-10-18 dry run, `checkin.spec.ts`: "a vendor looking up on another day is not invited to check in for it").
Every date's card has "Check in", and checking in on another day is not refused, but only today's is the main button and marked "Today"; nothing invites a vendor to check in for another day, since a check-in is how the organizer knows a vendor is there on the day.
The note "Today is not one of your days at this market. You can still check in for a day below." is gone.

## K4. Undo a check-in

**Status:** Works (walked live).
"Undo" on a checked-in card removes it; the organizer can undo one at the door too (K5).
Covered by: `checkin.spec.ts` ("a check-in on the wrong day can be undone"), `the-door-on-market-day.spec.ts`.

## K5. Watch attendance

**Status:** Works (re-walked live on 2026-10-03; the door rebuilt since, read from the code as of E29 and E35/F01/S02: `the-door-on-market-day.spec.ts`, `the-door-keeps-its-own-day.spec.ts`).

1. Attendance opens on today when it is a market date, else the next one, else the last; each date is a button with "checked in / expected".
2. "N of M checked in", and "All M", "Not yet N" (or "Did not come N" once the day is over or the market archived) and "Checked in N" to show one or the other.
3. "Find a vendor" ("Name, email or table") narrows the list.
4. Each vendor placed that day, by table: their name, which opens the [vendor drawer](vendor-drawer.md) and never checks them in; the time they checked in and by whom ("by you", or the organizer's address; a vendor's own check-in names nobody), or "Not yet"; and their notes under the row when they have some.
5. While the market is in Market Days, "Check in" and "Undo" on each row check a vendor in at the door.

It lists everyone expected on the day, so it shows who is missing; "Nobody is placed on this date." on a date with nobody.
It works at a phone's width, the one organizer screen that does.
Covered by: `the-door-on-market-day.spec.ts`, `the-door-keeps-its-own-day.spec.ts`, `a-seat-and-an-entry-open-the-drawer.spec.ts`, `checkin.spec.ts`.

## The rules it obeys

- [Publish Results waits for the allocation](../rules/publish-results-waits-for-the-allocation.md): a market whose vendors apply on its page goes live only after its applicants are told.
- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): check-in is served on both paths.
- [An archived market that ran stays a record](../rules/an-archived-market-that-ran-stays-a-record.md): the check-in page after the market ([L1](ending-and-managing-a-market.md#l1-archive-after-market-days)).
- [What each role may do](../rules/what-each-role-may-do.md): publishing is an Admin's, checking in at the door an Editor's.

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
