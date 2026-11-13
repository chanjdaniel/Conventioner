---
layer: business
kind: flow
describes:
  - front-end/src/views/AttendanceStatusView.vue
  - front-end/src/components/vendorPage/VendorCheckIn.vue
verified: 2026-11-04
sources:
  - brain-dump/2026-10-19#15
  - E10/F01/S02
  - E15/F02/S04
  - E29
  - E30/F01/S02
  - E31/F03/S02
  - E32/F01/S01
  - E35/F01/S02
  - E36/F04/S02
  - bug/1
  - E08/F03
  - T15
  - E38/F09/S01
  - E38/F15/S04
  - T202
  - T316
---

# Publishing, and the door on market day

**Who:** the market's Admin or owner publishes; an Editor shows the door code and checks vendors in at the door; a vendor, with no account, signs in on their vendor page with a code mailed to them and checks themselves in with the door code.
**Where they start:** the phase rail in Assignment; on the day, the organizer on the Attendance tab and the vendor at the door code's QR code, or at their vendor page.
**Serves:** [Results go out once, and settle the allocation](../intents/results-go-out-once-and-settle-the-allocation.md) and [The door on market day](../intents/the-door-on-market-day.md).

Publishing opens the market's days; from then on the market is in Market Days, and the door is two pages over one roster of who is placed where: the vendor's own check-in on their vendor page ([`VendorCheckIn.vue`](../../../front-end/src/components/vendorPage/VendorCheckIn.vue)) and the organizer's Attendance ([`AttendanceStatusView.vue`](../../../front-end/src/views/AttendanceStatusView.vue)).
A vendor's check-in proves presence: it takes their sign-in and the door code the organizer shows at the entrance ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)).
Both read the stored assignment, so a vendor placed, swapped or freed by hand is sent where they were put; how the door works is [attendance and the door](../../implementation/modules/attendance-and-door.md).

## K1. Publish the market

**Status:** Works (re-walked live on 2026-10-03; its refusals, the landing and the tab read from the code as of E31/F03/S02, E32/F01/S01 and E36/F04/S02).
**Task:** "Your assignment is final. Make it live so vendors can find their tables."

1. Rail: "Publish market", the main button in Assignment.
2. "Publish market?": "Publishing opens the market's days: every vendor you assigned checks in on their vendor page with the door code you show at the entrance, from Attendance. The tables they see are the ones you have now." and "A published market cannot be returned to an earlier phase."; focus starts on Cancel.
3. Expect Market Days, landing on Attendance, and "Vendor page" with its address and "Copy" in the rail; the rail says "Check vendors in at the door."

Disabled before the click, with the rail naming the first blocker:

- no assignment is stored: "No tables have been allocated for this market, so its vendor page could not tell anyone where to stand. Allocate tables first.", with "Allocate tables";
- every seat freed after results are published, when a run is refused: "Nobody has a table, so this market's vendor page could not tell anyone where to stand. Results are published, so tables are not allocated again: assign each one by hand.", with "Assign tables", which leads to Assignments (T316);
- a hand placement names a seat the plan no longer has ([J10](placing-by-hand.md#j10-a-pin-the-plan-no-longer-holds));
- the results are not published, on either path: "Vendors have not been told whether they have a table. Publish the results before the market goes live.", with "Publish results" ([I7](assignment-and-result.md#i7-publish-results)).

The Attendance tab is on the bar in every phase; before publishing it says "Opens when the market is published."
Covered by:

- `phase-rail.spec.ts`
- `phase-state-machine.spec.ts`
- `results-wait-for-the-allocation.spec.ts`
- `tier2.spec.ts`

## K2. A vendor scans the door code and is checked in

**Status:** Works (read from the code as of T202, `checkin.spec.ts`).
**Task (vendor):** "You are at the market's entrance. Check in."

1. Scan the door code's QR code with the phone's own camera; it opens the market's vendor page, `/<market-slug>?door=<code>`, and the code goes from the address at once.
2. Signed out, the page says "Sign in, and you'll be checked in for today." over the sign-in: an email address, then the code mailed to it ([applying online](applying-online.md)).
3. Expect, once signed in, today's seat on top, "Today", the date and the table in words with its size and location, and "Checked in at <time>" with "Undo"; their other days are listed below.

A vendor signed in already is checked in at once.
With no seat today the page says "You have no table today, so you are not checked in."; before the market's days "Check-in opens when the market's days begin."; once it has ended "This market has ended, so check-in is closed."; none checks anything in.
A scanned code is used once: the page reloaded checks nobody in again.
The seats shown are the stored assignment, so a vendor placed, swapped or freed by hand is sent where they were put (bug 1).
It works alike on a Google Form market, whose vendor page opens once its results are published ([the Google Form path](the-google-form-path.md)).
Covered by:

- `checkin.spec.ts`

## K3. Type the door code

**Status:** Works (read from the code as of T202, `checkin.spec.ts`).
**Task (vendor):** "Your camera will not read the QR code. Check in."

1. On the vendor page, signed in, today's seat offers "Door code" ("Type the code under the QR code at the door.") and "Check in".
2. Type the code as the poster prints it, "K7M 4QP"; case, spaces and dashes do not matter.
3. Expect "Checked in at <time>" and "Undo".

A wrong code says "That isn't this market's door code. Check it, or ask at the door.", and so does a code the organizer has replaced (K5's "New code"); a scanned old poster says the same.
Only today's seat offers a check-in; nothing invites a vendor to check in for another day, since a check-in is how the organizer knows a vendor is there on the day.
Covered by:

- `checkin.spec.ts`

## K4. Undo a check-in

**Status:** Works (read from the code as of T202).
"Undo" beside "Checked in at <time>" takes it back, with no door code, and offers "Check in" again, on the day itself only, so a vendor never erases a past day's attendance; the organizer can undo one at the door too (K5).
Covered by:

- `checkin.spec.ts`
- `the-door-on-market-day.spec.ts`

## K5. Watch attendance

**Status:** Works (re-walked live on 2026-10-03; the door rebuilt since, read from the code as of E29 and E35/F01/S02: `the-door-on-market-day.spec.ts`, `the-door-keeps-its-own-day.spec.ts`).

1. Attendance opens on today when it is a market date, else the next one, else the last; each date is a button with "checked in / expected".
2. "N of M checked in", and "All M", "Not yet N" (or "Did not come N" once the day is over or the market archived) and "Checked in N" to show one or the other.
3. "Find a vendor" ("Name, email or table") narrows the list.
4. Each vendor placed that day, by table: their name, a link at rest (link ink, underlined, a 44px target on a phone), which opens the [vendor drawer](vendor-drawer.md) and never checks them in; how and when they checked in ("Scanned in at 9:41 AM" for their own, with the door code, "9:41 AM by you" or by the organizer's address), or "Not yet"; and their notes under the row when they have some.
5. While the market is in Market Days, "Check in" and "Undo" on each row check a vendor in at the door, for someone who may check vendors in.
   A Viewer is offered neither: they read the frame's "You can view this market but not change it. …", the rail's "Follow who has checked in at the door.", and each row ending at its status (E38/F15/S04).
6. In Market Days, someone who may check vendors in opens "Door code" at the end of the dates' row: the market's name, its QR code, the code as "K7M 4QP" and "Scan with your phone's camera to check in", full screen, for the tablet or laptop that stands at the entrance.
   With no code yet it offers "Make a door code".
   "Print" prints the same poster on one page, and "New code" asks "Make a new door code? The current code and every printed poster of it stop working.", on Cancel, before it makes another; the code stays the same until then.
   A Viewer is offered no Door code, and the server refuses them the code.

It lists everyone expected on the day, so it shows who is missing; "Nobody is assigned on this date." on a date with nobody.
It works at a phone's width, as only the other organizer screens that fit a phone do ([attendance and the door](../../implementation/modules/attendance-and-door.md#sharp-edges)), and there its rows keep a gutter at both sides rather than running to the card's edges (T15).
Covered by:

- `a-seat-and-an-entry-open-the-drawer.spec.ts`
- `a-viewer-at-the-door-reads-why.spec.ts`
- `checkin.spec.ts`
- `the-door-code.spec.ts`
- `the-door-keeps-its-own-day.spec.ts`
- `the-door-on-market-day.spec.ts`

## The rules it obeys

- [Publish results waits for the allocation](../rules/publish-results-waits-for-the-allocation.md): a market whose vendors apply on its page goes live only after its applicants are told.
- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): check-in is served on both paths.
- [An archived market that ran stays a record](../rules/an-archived-market-that-ran-stays-a-record.md): the vendor page after the market ([L1](ending-and-managing-a-market.md#l1-archive-after-market-days)).
- [What each role may do](../rules/what-each-role-may-do.md): publishing is an Admin's, checking in at the door an Editor's.
- [Vendor notes](../rules/vendor-notes.md): a request is marked handled at the door, and the mark can be taken back.

Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
