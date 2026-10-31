---
layer: implementation
kind: module
describes:
  - back-end/api/attendance.py
  - back-end/api/door.py
  - back-end/app.py#public_get_vendor_assignments
  - back-end/app.py#public_checkin_page
  - back-end/app.py#_no_check_in_at
  - back-end/app.py#public_attendance_undo
  - back-end/app.py#public_attendance_checkin
  - back-end/app.py#get_market_attendance
  - back-end/app.py#_door_write
  - back-end/app.py#organizer_check_in
  - back-end/app.py#organizer_undo_check_in
  - front-end/src/views/AttendanceStatusView.vue
  - front-end/src/App.vue#fitsAPhone
verified: 2026-10-31
sources:
  - wayfinding/real-market-readiness/map
  - wayfinding/claims-and-room/map
  - wayfinding/readable-journey/06
  - wayfinding/readable-journey/map
  - E29
  - E29/F01/S01
  - E29/F01/S02
  - E26/F06/S02
  - bug/1
  - bug/9
  - known-gap/3
  - T15
  - T82
  - T142
---

# Attendance and the door

Who comes on market day, recorded at two doors: the vendor's own check-in page, public and keyed by the market's address, and the organizer's Attendance page, keyed by the market's id.
[`back-end/api/attendance.py`](../../../back-end/api/attendance.py) owns the `attendance` collection and both readings of it; [`back-end/api/door.py`](../../../back-end/api/door.py) is the organizer's door; the routes are in [`back-end/app.py`](../../../back-end/app.py); the organizer's page is [`AttendanceStatusView.vue`](../../../front-end/src/views/AttendanceStatusView.vue).

## The collection

One document per `(market_id, vendor_email, date)`, stored snake_case, upserted by `record_attendance` with `checked_in_at` (ISO 8601 UTC, the latest check-in) and `checked_in_by` (the organizer's address, or None for the vendor's own).
The vendor's address is normalised (`utils/email_address.normalized_email`) on every write and lookup.
Undoing a check-in deletes its document: nothing else was changed by it.
The `(market_id, vendor_email)` index is in [the lookup indexes](../data/lookup-indexes.md), and the collection goes with the market when it is deleted.

## The routes

| Route | Who | Does |
| --- | --- | --- |
| `GET /public/markets/<slug>/check-in` | anyone | which market this is, its dates, and whether it has `ended` |
| `GET /public/markets/<slug>/vendors/<email>/assignments` | anyone | that vendor's seats, each with when they checked in |
| `POST`/`DELETE /public/markets/<slug>/attendance/checkin` | anyone | the vendor's own check-in, or its undo |
| `GET /markets/<id>/attendance` | the Read row: any role | the roster |
| `POST`/`DELETE /markets/<id>/attendance` | the Check vendors in row: EDITOR by default | the organizer's check-in, or its undo |

## Sharp edges

**Attendance is a roster off the stored assignment.**
`GET /markets/:id/attendance` serves `{dates, roster}`: every vendor the stored assignment places on each date, with `checkedInAt` and `checkedInBy` (`attendance_roster`).
Never derive who is expected from check-in records: that list is who came, and it is how the page could not say who was missing on a day of 80 vendors (known gap 3).
The roster, the vendor's lookup and the check-in all read the same stored rows, so who is expected where can never disagree with where a vendor is sent; the lookup once ran the solver afresh and sent a vendor moved by hand to their old seat (bug 1).

**A check-in needs a stored placement for that vendor on that date**, or it is a 404.
A placement is dated by the market date itself, so no reader maps anything back to a date.

**An organizer checks a vendor in through `api/door.py`**: the table's Check vendors in row ([the market's actions](market-actions.md)), EDITOR by default, the bar every market write sets, so a door volunteer is added to the market as an editor.
It loads through the change loader (`_load_market_to_change`), so an archived market's record is never changed, and refuses with a 409 outside `market_days`.
It writes through `record_attendance`, which stamps `checked_in_by`, so the two doors record alike, and a vendor checking in again after an organizer did is no longer credited to the organizer.
`_door_write` catches nothing: a market that does not exist answers 404, an archived one or a person the row refuses 403 with its sentence, and one that cannot be read `Invalid market data`, 400, each raised by the change loader ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md)); a body that is not a JSON object is `A JSON object is required`, 400.
A vendor checking in on another day than today is not refused, and no screen suggests it.

**An archived market that ran is still served, as a record** ([an archived market that ran stays a record](../../business/rules/an-archived-market-that-ran-stays-a-record.md)).
`get_check_in_market` serves a running market, or an archived one whose phase record says it ran, marked `ended`: its page shows each vendor's seats and check-ins and takes no check-in.
A write there answers 409 with "This market has ended, so check-in is closed."; an address with no market answers 404.
An archived market that never ran has no check-in page.
Check-in is open to every market that runs, whatever its intake mode: how a vendor entered has no bearing on whether they can scan in on the day ([intake mode decides how vendors arrive](../../business/rules/intake-mode-decides-how-vendors-arrive.md)); the applicant surface is a lookup of its own ([a gated market answers as absent](../../business/rules/a-gated-market-answers-as-absent.md)).

**The door works on a phone, and so does the Tools tab.**
The product is built for a laptop, and the other organizer market screens need not work below a laptop's width; the door is the carve-out among them, the one someone may hold in their hand, and the Tools tab the second, since an organizer may connect Discord from a phone (Daniel, T113).
The account pages on the way in fit a phone too ([the design language](../../design-system.md#layout)).
The vendors' own check-in page is not an organizer screen at all, so the organizer screens' widths never apply to it.
A route with `meta: { fitsAPhone: true }` lifts the app's 1000px desktop floor ([`fitsAPhone`](../../../front-end/src/App.vue)) and nothing else, as every public page does; at 640px and below the market bar's tabs and the rail's spine scroll sideways inside themselves.
Of the organizer market screens Attendance has it, because the door is sometimes a person standing up, and so does Tools.
At that width only the banner and the market bar stay pinned, 138px of an 844px window, and the rail scrolls away with the page ([the market frame](market-frame.md)); the rail is laid out for a phone, its addresses named as chips and its actions wrapping beside them, so on a form market in market days the door starts at 317px of 844 on first paint rather than 409px, and `phase-rail.spec.ts` holds it at or above 340px ([the phase rail](phase-rail.md)).
At that width the door's gutter narrows to `--space-4` and stays on both sides; at 0 its rows ran to the card's edges (T15).
Every target the door's organizer and its vendors tap there is 44px, through the design language's [target tokens](../../design-system.md#the-primitive-layer); the layout sweep walks the attendance, its navigation drawer, vendor drawer, rail menu and archive confirmation, and the check-in page before and after a lookup at 390px, and fails on a target under 44px (T82).

**Each check-in and its undo records into [the market's history](../data/history.md)** (`checked_in`, `check_in_undone`, under `check-in`) in `record_attendance` and `undo_attendance`, so both doors record alike, and only when whether the vendor is here changed: the organizer is the actor at theirs, and the public check-in page, which proves nobody, records no actor and `via: check_in_page`.

## Why

The page an organizer works from at the door, and the record a market leaves behind.
The phase record that says whether a market ran is `back-end/phase_record.py`; the date "today" is the viewer's own (`calendarToday` in [the market guide](market-guide.md)).
Publishing, the vendor's check-in page and Attendance, as the people at the door use them, are [the door on market day](../../business/flows/market-day-door.md).

The glossary concept it serves: [Placement and pin](../../business/concepts/placement-and-pin.md).
