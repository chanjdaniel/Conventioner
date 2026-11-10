---
layer: implementation
kind: module
describes:
  - back-end/api/attendance.py
  - back-end/app.py#verify_attendance_indexes
  - front-end/e2e/one-record-for-a-vendors-day.spec.ts
  - back-end/api/door.py
  - back-end/api/vendor_check_in.py
  - back-end/app.py#vendor_check_in
  - back-end/app.py#vendor_undo_check_in
  - back-end/app.py#get_market_attendance
  - back-end/app.py#_door_write
  - back-end/app.py#organizer_check_in
  - back-end/app.py#organizer_undo_check_in
  - back-end/app.py#get_door_code
  - back-end/app.py#make_door_code
  - front-end/src/views/AttendanceStatusView.vue
  - front-end/src/components/DoorCodeScreen.vue
  - front-end/src/utils/doorCode.ts
  - front-end/src/utils/qrDrawing.ts
  - front-end/src/components/vendorPage/VendorCheckIn.vue
  - front-end/src/App.vue#fitsAPhone
  - front-end/src/utils/fitsAPhone.ts
verified: 2026-11-10
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
  - T148
  - E38/F15/S04
  - T202
  - T251
  - T270
---

# Attendance and the door

Who comes on market day, recorded at two doors: the vendor's own check-in, on their vendor page behind their sign-in and the market's door code, keyed by the market's address, and the organizer's Attendance page, keyed by the market's id.
[`back-end/api/attendance.py`](../../../back-end/api/attendance.py) owns the `attendance` collection and both readings of it; [`back-end/api/door.py`](../../../back-end/api/door.py) is the organizer's door and the door code; [`back-end/api/vendor_check_in.py`](../../../back-end/api/vendor_check_in.py) is the vendor's; the routes are in [`back-end/app.py`](../../../back-end/app.py); the organizer's page is [`AttendanceStatusView.vue`](../../../front-end/src/views/AttendanceStatusView.vue), and the vendor's is the check-in section of the vendor page, [`VendorCheckIn.vue`](../../../front-end/src/components/vendorPage/VendorCheckIn.vue).

## The collection

One document per `(market_id, vendor_email, date)`, stored snake_case, upserted by `record_attendance` with `checked_in_at` (ISO 8601 UTC, the latest check-in), `checked_in_by` (the organizer's address, or None for the vendor's own) and `checked_in_via` (`door_code` for the vendor's own, else None).
A check-in made on the public check-in page before it was removed has `checked_in_by` None and no `checked_in_via`.
The vendor's address is normalised (`utils/email_address.normalized_email`) on every write and lookup.
Undoing a check-in deletes its document: nothing else was changed by it.
The collection goes with the market when it is deleted.

### One vendor's day is one record, by the database

The one document per vendor's day is the database's to hold, not the upsert's (T270).
An upsert with no unique index behind it can insert twice when two land at once, so without the index two organizers at the door, or an organizer's tap and the vendor's own door-code check-in, could leave two records: one Undo would take one away and leave the vendor reading as here, and the history would hold two arrivals.

- `ensure_attendance_indexes` builds `attendance_vendor_day_unique`, unique on `(market_id, vendor_email, date)`, through [`unique_indexes.py`](../../../back-end/unique_indexes.py), and `app.py`'s `verify_attendance_indexes` refuses to boot without it, naming any duplicates by market id, date and record id, never by address ([OPERATIONS.md](../../OPERATIONS.md#when-the-back-end-refuses-to-boot)).
- `record_attendance` runs its upsert once more on a `DuplicateKeyError`, which then lands on the winner's record; a second refusal goes on as the error it is.
  MongoDB itself retries such an upsert when its query is equality on the unique index's fields, so the retry is the fallback when the server does not.
- Only the call whose upsert inserted the record writes the "checked in" entry, so two racing check-ins write one.
- The index's prefix serves a vendor's check-ins, so `attendance` has no lookup index of its own in [the lookup indexes](../data/lookup-indexes.md); a database that already held the old `(market_id, vendor_email)` one keeps it, which is harmless.
- [`one-record-for-a-vendors-day.spec.ts`](../../../front-end/e2e/one-record-for-a-vendors-day.spec.ts) proves the refusal and 16 check-ins at once on the stack's real MongoDB; the back end's suite runs on fakes, which hold no index.

## The routes

| Route                                           | Who                                                        | Does                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /public/markets/<slug>/vendor/check-in`   | the vendor, signed in, with the live door code             | their own check-in for `date`, `{date, doorCode}`                                      |
| `DELETE /public/markets/<slug>/vendor/check-in` | the vendor, signed in                                      | the undo of their check-in for `date`, within a day of the server's date, no door code |
| `GET /markets/<id>/attendance`                  | the Read row: any role                                     | the roster                                                                             |
| `POST`/`DELETE /markets/<id>/attendance`        | the Check vendors in row: EDITOR by default                | the organizer's check-in, or its undo                                                  |
| `GET /markets/<id>/door-code`                   | the Check vendors in row                                   | the door code, `{code, madeAt, madeBy, url}`, or `{code: null}`                        |
| `POST /markets/<id>/door-code`                  | the Check vendors in row, in `market_days`, never archived | a new door code, which ends the old one                                                |

## Sharp edges

**Attendance is a roster off the stored assignment.**
`GET /markets/:id/attendance` serves `{dates, roster}`: every vendor the stored assignment places on each date, with `checkedInAt`, `checkedInBy` and `checkedInVia` (`attendance_roster`).
Never derive who is expected from check-in records: that list is who came, and it is how the page could not say who was missing on a day of 80 vendors (known gap 3).
The roster, the vendor's own read and the check-in all read the same stored rows, so who is expected where can never disagree with where a vendor is sent; the public lookup once ran the solver afresh and sent a vendor moved by hand to their old seat (bug 1).
A row's status says who checked the vendor in: "Scanned in at 9:41 AM" for the vendor's own (`checkedInVia: door_code`), "9:41 AM by you" or "by <organizer>" for an organizer's, and the time alone for one made on the old public page.
A vendor's own check-in times are `check_ins_of`, which the vendor page's own read uses, so each seat a vendor reads carries when they checked in to it ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)); whether a market ran is `market_ran`.

**A check-in needs a stored placement for that vendor on that date** (`seated_on`), or it is a 404.
A placement is dated by the market date itself, so no reader maps anything back to a date.

**A vendor checks themselves in only signed in, and only with the door code** ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)).
The check-in was a public page at `/<slug>/check-in`, where anyone with the market's address typed any vendor's email, read their seats and checked them in or out, so a check-in proved nothing; it, its read and its four public endpoints are gone, and answer 404.
`api/vendor_check_in.py` wants the vendor page's Bearer token (401 without), counts every try against `check-in:address` (10 in 15 minutes) by the token's address, refuses a caller already past 60 wrong codes in 15 minutes (`check-in:caller`, read before the code is compared, so a right guess after them is refused too) and counts each wrong code against it, a right code never, so a vendor at home cannot guess the code ([`sign_in_limits`](../../../back-end/sign_in_limits.py), beside the sign-in's own bounds in [a vendor signs in before they have applied](../../business/rules/a-vendor-signs-in-before-applying.md#sign-in-is-bounded)), and goes through the vendor page gate (`vendor_page_market_by_slug`), so a market with no vendor page answers exactly as a slug that names nothing.
Then, each with its own sentence and writing nothing: a token for another market (403, "Your sign-in is for a different market. Please sign in again."), an archived market (409, "This market has ended, so check-in is closed."), any phase before `market_days` (409, "Check-in opens when the market's days begin."), no seat for them on `date` (404, "You have no table on this date."), a `date` more than a day from the server's UTC date (409, "Check-in is open on the day itself."), so a code read today cannot check them in for next week while "today" is still in reach in every time zone, and a code that is not the live one (403, "That isn't this market's door code. Check it, or ask at the door.").
The code is compared in `api/door.py` (`door_code_matches`), upper-cased with its spaces and dashes dropped, in constant time, so the live code never leaves that module; a market with no code yet matches nothing.
It writes through `record_attendance` with `checked_in_by` None and `checked_in_via: door_code`; the undo takes no door code, only the vendor's sign-in, `market_days` and a date within the same one-day window, counting nothing against a limit, and takes back their check-in for the date, whoever made it, so an organizer's check-in today may be undone by the vendor but no past day's by anyone but an organizer.
Both read their body with `json_object`, so a body that is not a JSON object is `A JSON object is required`, 400 ([a request value is a string](../conventions/a-request-value-is-a-string.md)).

**The vendor page checks a scanned vendor in for today, after the sign-in it may take** ([`VendorCheckIn.vue`](../../../front-end/src/components/vendorPage/VendorCheckIn.vue), [`VendorPage.vue`](../../../front-end/src/views/VendorPage.vue)).
The QR code opens `/<slug>?door=<code>`: the page keeps the code in this tab's `sessionStorage` (the application store's `holdDoorCode`) and takes it off the address at once with `router.replace`, and "Sign in, and you'll be checked in for today." stands over the sign-in while it waits.
Once the vendor's own read has loaded, the check-in section takes the code (`takeDoorCode`, used once) and checks them in for today's seat; with no seat today, before the market's days or once it has ended, it says so instead (`scannedCodeRefusal`) and sends nothing, and a seat already checked in to sends nothing either.
A sign-in that ran out mid-check-in (401) takes the page back to the sign-in with the code held again, so it checks them in after the next.
"Today" is the vendor's own calendar day (`calendarToday`), read again whenever the page comes back into view.
In Market Days the section shows today's seat on top with Check in, a "Door code" field for a vendor whose camera will not read the QR code, then "Checked in at <time>" with Undo, and the other days listed below; the status card then lists no seats, since the section does.
Archived after it ran, it is "Where you sat": each seat, and when they checked in or "Not checked in", and no check-in.
It works alike on both kinds of market: a Google Form market's vendor page opens once its results are published ([a gated market answers as absent](../../business/rules/a-gated-market-answers-as-absent.md)).
[`checkin.spec.ts`](../../../front-end/e2e/checkin.spec.ts) walks the door: the organizer makes the code, a vendor opens its `url` signed out, signs in and lands checked in, and the roster says "Scanned in"; a new code makes the old `url` refuse; a typed code and its Undo; a scan with no table today; and the old endpoints' 404.

**An organizer checks a vendor in through `api/door.py`**: the table's Check vendors in row ([the market's actions](market-actions.md)), EDITOR by default, the bar every market write sets, so a door volunteer is added to the market as an editor.
It loads through the change loader (`_load_market_to_change`), so an archived market's record is never changed, and refuses with a 409 outside `market_days`.
It writes through `record_attendance`, which stamps `checked_in_by`, so the two doors record alike, and a vendor checking in again after an organizer did is no longer credited to the organizer.
`_door_write` catches nothing: a market that does not exist answers 404, an archived one or a person the row refuses 403 with its sentence, and one that cannot be read `Invalid market data`, 400, each raised by the change loader ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md)); a body that is not a JSON object is `A JSON object is required`, 400.
A vendor checking in on another day than today is not refused, and no screen suggests it.

**The page offers Check in and Undo only in Market Days, to someone who may check vendors in, and a row offering neither ends at its status** (`door-row--read`).
At a desk each row's last column, 7rem, holds the action; for someone offered none it is dropped, since the empty column left each status about 130px short of the row's edge (E38/F15/S04).
On a phone the vendor's line holds only the vendor and the action, and the table and the status share a line of their own under it (`door-place`), the status at its end or, when both do not fit, under the table: in the action's column a wide status ("9:44 AM by" an address) squeezed the vendor's line and broke their address mid-word.
So the vendor comes first in the row's markup, and at a desk each cell is placed in its column, the table first.
[`a-viewer-at-the-door-reads-why.spec.ts`](../../../front-end/e2e/a-viewer-at-the-door-reads-why.spec.ts) holds both widths for a Viewer and an Editor, every address on one line.

**An archived market that ran is still served, as a record** ([an archived market that ran stays a record](../../business/rules/an-archived-market-that-ran-stays-a-record.md)).
Its vendor page's read says it has `ended` (`ended_after_it_ran`), and each vendor's own read carries their seats and when they checked in, so the page shows the record and takes no check-in; a check-in there answers 409 with "This market has ended, so check-in is closed.".
Check-in is open to every market that runs, whatever its intake mode: how a vendor entered has no bearing on whether they can check in on the day ([intake mode decides how vendors arrive](../../business/rules/intake-mode-decides-how-vendors-arrive.md)); applying is a lookup of its own ([a gated market answers as absent](../../business/rules/a-gated-market-answers-as-absent.md)).

**The door works on a phone, as do the organizer screens it leads to.**
The product is built for a laptop, and an organizer market screen need not work below a laptop's width unless [the design language](../../design-system.md#layout) lists it as fitting a phone; the door is one carve-out, the one someone may hold in their hand, and the Tools tab another, since an organizer may connect Discord from a phone (Daniel, T113).
The account pages on the way in fit a phone too ([the design language](../../design-system.md#layout)).
The vendor page, where vendors check in, is not an organizer screen at all, so the organizer screens' widths never apply to it.
A route with `meta: { fitsAPhone: true }`, or a page its `meta.fitsAPhone` lists on a route that is several pages ([the market frame](market-frame.md#sharp-edges)), lifts the app's 1000px desktop floor ([`fitsAPhone`](../../../front-end/src/utils/fitsAPhone.ts), read by [`App.vue`](../../../front-end/src/App.vue)), as every public page does, and gives the market frame the phone's 16px gutter ([the market frame](market-frame.md#sharp-edges)); at 640px and below the rail's spine scrolls sideways inside itself, and below about a 990px window the market bar's tabs do ([the market frame](market-frame.md)).
Of the organizer market screens Attendance has it, because the door is sometimes a person standing up, and so does each place the door's journey reaches; [the design language](../../design-system.md#layout) lists every place that has it, one a line.
So the door's journey fits a phone from end to end: `/markets`, the door, a check-in, each of the vendor drawer's tabs, and "Change assignment" to the Assignments page and its change-placement dialog.
[`the-door-on-a-phone.spec.ts`](../../../front-end/e2e/the-door-on-a-phone.spec.ts) walks it at 390x844 under a phone's own emulation (touch, device scaling), and at 1440x900, where the bar and the whole rail stay pinned.
At that width only the app bar and the market bar stay pinned, 138px of an 844px window, and the rail scrolls away with the page ([the market frame](market-frame.md)); the rail is laid out for a phone, its addresses named as chips and its actions wrapping beside them, so on a form market in market days the door starts within the top 340px of 844 on first paint rather than at 409px, which `phase-rail.spec.ts` holds it to ([the phase rail](phase-rail.md)).
At that width the door's gutter narrows to `--space-4` and stays on both sides; at 0 its rows ran to the card's edges (T15).
Every target the door's organizer and its vendors tap there is 44px, through the design language's [target tokens](../../design-system.md#the-primitive-layer); the layout sweep walks the attendance, the app bar's sheet, the vendor drawer on each of its tabs, rail menu and archive confirmation, and the vendor page on a market day, checked in and as the record, at 390px, and fails on a target under 44px (T82).
A roster that could not be read says which kind of failure it was, with a Try again, 44px on a phone, that reads it once more, apart from a check-in or undo the server did not record ([what the organizer reads](../conventions/an-exception-never-reaches-a-client.md#what-the-organizer-reads)).

**The door code is the market's, one at a time, and no market read serves it** ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)).
It is stored on the market document as `doorCode`, `{code, madeAt, madeBy}`, and `api/door.py` serves it on its own endpoints, to whoever may check vendors in: a Viewer who read it could check vendors in by proxy.
So `leave_out_what_no_read_serves` in [`back-end/market_documents.py`](../../../back-end/market_documents.py) takes it off the market read and every Markets list entry.
A code is 6 characters of `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no 0, O, 1 or I), each drawn by `secrets`.
Making one loads through the change loader, answers 409 outside `market_days`, and writes with a filter on the phase too, so a market archived since it was loaded is not changed; a new code replaces the old at once, so every poster of the old one stops working.
It records `door_code_made` with the organizer as the actor and `replaced` in its detail, never the code.
Its `url`, the address the QR code opens, is the vendor page with the code, `<FRONTEND_URL>/<slug>?door=<code>`.

**Attendance offers "Door code" in Market Days to whoever may check vendors in** (`offersDoorCode` in [`doorCode.ts`](../../../front-end/src/utils/doorCode.ts)), and it opens [`DoorCodeScreen.vue`](../../../front-end/src/components/DoorCodeScreen.vue) over the whole window: the market's name, the QR code, the code in two groups of three ("K7M 4QP"), "Scan with your phone's camera to check in", and who made it and when.
It is a modal, not an `AppDialog`, which is a small window: it holds the page behind inert, takes Escape while on top and gives focus back to "Door code", as [every modal](../conventions/dialogs.md) does, and its one confirmation, "Make a new door code?", is an `AppDialog` teleported beside it that opens on Cancel.
The QR code is encoded by the `qrcode` package and drawn by the app as one SVG path (`qrDrawing` in [`qrDrawing.ts`](../../../front-end/src/utils/qrDrawing.ts), with the standard's four-module quiet zone, kept out of `doorCode.ts` so the vendor page, which reads and types the code with `normalizedDoorCode` and `DOOR_CODE_LENGTH` there, never loads the encoder), so no markup from the package reaches the page; `theDoorCode.test.ts` decodes the drawn path with `jsqr` back to the `url`.
The package loads only with Attendance's chunk, never the entry's ([the bundle budget](../testing/ci-and-the-gate.md#the-bundle-budget)).
The QR code's box is a square the window's width that gives up height where the rest needs it, and the typed code is the scale's display figure, `--text-2xl`.
"Print" prints the same poster on one page: the print rules sit in the component's scoped block, since unscoped ones lost to the scoped screen rules and the poster printed as the fixed screen; only the rule that hides the app, a sibling of the screen under `body`, is global.
[`the-door-code.spec.ts`](../../../front-end/e2e/the-door-code.spec.ts) holds the journey, the fit at 390 and 1280, a 14cm QR code on one Letter and one A4 page, a short window where the screen scrolls in a `ScrollBox` from its controls down and prints whole with no shade, and a Viewer offered nothing and refused the code; the layout sweep walks it before a code, full screen and at its confirmation.

**Each check-in and its undo records into [the market's history](../data/history.md)** (`checked_in`, `check_in_undone`, under `check-in`) in `record_attendance` and `undo_attendance`, so both doors record alike, and only when whether the vendor is here changed: the organizer is the actor at theirs, and the vendor's own records no actor beside the vendor it names, with `via: door_code` for a check-in and `via: vendor_page` for an undo; an entry from the old public page keeps `via: check_in_page`, and its readers word all three.

## Why

The page an organizer works from at the door, and the record a market leaves behind.
The phase record that says whether a market ran is `back-end/phase_record.py`; the date "today" is the viewer's own (`calendarToday` in [the market guide](market-guide.md)).
Publishing, the door code, the vendor's check-in on their vendor page and Attendance, as the people at the door use them, are [the door on market day](../../business/flows/market-day-door.md).

The glossary concept it serves: [Placement and pin](../../business/concepts/placement-and-pin.md).
