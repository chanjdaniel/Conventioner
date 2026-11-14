---
layer: implementation
kind: module
describes:
  - back-end/api/attendance.py
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
  - front-end/src/components/ListFreshness.vue
  - front-end/src/components/DoorCodeScreen.vue
  - front-end/src/components/DoorRosterPrint.vue
  - front-end/src/utils/doorCode.ts
  - front-end/src/utils/qrDrawing.ts
  - front-end/src/components/vendorPage/VendorCheckIn.vue
  - front-end/src/App.vue#fitsAPhone
  - front-end/src/utils/fitsAPhone.ts
  - back-end/app.py#verify_attendance_indexes
  - front-end/e2e/one-record-for-a-vendors-day.spec.ts
verified: 2026-11-14
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
  - T201
  - T274
  - T318
---

# Attendance and the door

Who comes on market day, recorded at two doors: the vendor's own check-in, on their vendor page behind their sign-in and the market's door code, keyed by the market's address, and the organizer's Attendance page, keyed by the market's id.
[`back-end/api/attendance.py`](../../../back-end/api/attendance.py) owns the `attendance` collection and both readings of it; [`back-end/api/door.py`](../../../back-end/api/door.py) is the organizer's door and the door code; [`back-end/api/vendor_check_in.py`](../../../back-end/api/vendor_check_in.py) is the vendor's; the routes are in [`back-end/app.py`](../../../back-end/app.py); the organizer's page is [`AttendanceStatusView.vue`](../../../front-end/src/views/AttendanceStatusView.vue), and the vendor's is the check-in section of the vendor page, [`VendorCheckIn.vue`](../../../front-end/src/components/vendorPage/VendorCheckIn.vue).

## The collection

One document per `(market_id, vendor_email, date)`, stored snake_case, upserted by `record_attendance` with `table_code` (the table code of the seat the vendor held when it was made, T318), `checked_in_at` (ISO 8601 UTC, the latest check-in), `checked_in_by` (the organizer's address, or None for the vendor's own) and `checked_in_via` (`door_code` for the vendor's own, else None).
Checking in again updates the table with the time, so a vendor checked in again at a new seat is recorded there.
A check-in made on the public check-in page before it was removed has `checked_in_by` None and no `checked_in_via`, and one made before T318 has no `table_code`: it is read as made at the seat the vendor holds now, which is the answer a stored table would give, so nothing was migrated.
The vendor's address is normalised (`utils/email_address.normalized_email`) on every write and lookup.
Undoing a check-in deletes its document: nothing else was changed by it.
The collection goes with the market when it is deleted.

### One vendor's day is one record, by the database

The one document per vendor's day is the database's to hold, not the upsert's (T270).
An upsert with no unique index behind it can insert twice when two land at once, so without the index two organizers at the door, or an organizer's tap and the vendor's own door-code check-in, could leave two records: one Undo would take one away and leave the vendor reading as here, and the history would hold two arrivals.

- `ensure_attendance_indexes` builds `attendance_vendor_day_unique`, unique on `(market_id, vendor_email, date)`, through [`unique_indexes.py`](../../../back-end/unique_indexes.py), and `app.py`'s `verify_attendance_indexes` refuses to boot without it, naming any duplicates by market id, date and record id, never by address ([OPERATIONS.md](../../OPERATIONS.md#when-the-back-end-refuses-to-boot)).
- `record_attendance` writes by `find_one_and_update(..., upsert=True, return_document=BEFORE)`, so it knows whether it inserted the record and what it replaced, and runs it once more on a `DuplicateKeyError`, which then lands on the winner's record; a second refusal goes on as the error it is.
  MongoDB itself retries such an upsert when its query is equality on the unique index's fields, so the retry is the fallback when the server does not.
- Only the call whose upsert inserted the record writes the "checked in" entry, so two racing check-ins write one.
- The index's prefix serves a vendor's check-ins, so `attendance` has no lookup index of its own in [the lookup indexes](../data/lookup-indexes.md); a database that already held the old `(market_id, vendor_email)` one keeps it, which is harmless.
- [`one-record-for-a-vendors-day.spec.ts`](../../../front-end/e2e/one-record-for-a-vendors-day.spec.ts) proves the refusal and 16 check-ins at once on the stack's real MongoDB; the back end's suite runs on fakes, which hold no index, except [the real-MongoDB suite](../testing/real-mongo-suite.md), which builds the index through the boot, refuses to start over two planted records of one vendor's day, and races 20 check-ins of one vendor's day, which leave one record and one "checked in" entry ([one record per vendor's day](../testing/real-mongo-suite.md#one-record-per-vendors-day)).

## The routes

| Route                                           | Who                                                        | Does                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /public/markets/<slug>/vendor/check-in`   | the vendor, signed in, with the live door code             | their own check-in for `date`, `{date, doorCode}`                                      |
| `DELETE /public/markets/<slug>/vendor/check-in` | the vendor, signed in                                      | the undo of their check-in for `date`, within a day of the server's date, no door code |
| `GET /markets/<id>/attendance`                  | the Read row: any role                                     | the roster                                                                             |
| `POST`/`DELETE /markets/<id>/attendance`        | the Check vendors in row: EDITOR by default                | the organizer's check-in for a day that has begun, or its undo                         |
| `GET /markets/<id>/door-code`                   | the Check vendors in row                                   | the door code, `{code, madeAt, madeBy, url}`, or `{code: null}`                        |
| `POST /markets/<id>/door-code`                  | the Check vendors in row, in `market_days`, never archived | a new door code, which ends the old one                                                |

## Sharp edges

**Attendance is a roster off the stored assignment.**
`GET /markets/:id/attendance` serves `{dates, roster}`: every vendor the stored assignment places on each date, with `state`, `checkedInTableCode`, `checkedInAt`, `checkedInBy` and `checkedInVia` (`attendance_roster`), and after a date's seated rows, a row for each check-in of that date whose vendor holds no seat on it.
Never derive who is expected from check-in records: that list is who came, and it is how the page could not say who was missing on a day of 80 vendors (known gap 3).
The roster, the vendor's own read and the check-in all read the same stored rows, so who is expected where can never disagree with where a vendor is sent; the public lookup once ran the solver afresh and sent a vendor moved by hand to their old seat (bug 1).
A row's status says who checked the vendor in: "Scanned in at 9:41 AM" for the vendor's own (`checkedInVia: door_code`), "9:41 AM by you" or "by <organizer>" for an organizer's, and the time alone for one made on the old public page.
A vendor's own check-in times are `check_ins_of`, which the vendor page's own read uses, so each seat a vendor reads carries when they checked in to it ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)); whether a market ran is `market_ran`.
The Stats tab's Check-in is `check_in_counts`, beside the roster: the same stored rows and attendance records, counted per date as the door's "18/24" counts them and with `came`, the vendors in on any date, but reading no names and sending no row ([who has come](../../business/flows/stats.md#n6-see-who-has-come)).

**A check-in needs a stored placement for that vendor on that date** (`seat_on`, the stored row or None; `seated_on` asks whether there is one), or it is a 404.
A placement is dated by the market date itself, so no reader maps anything back to a date.

**A check-in keeps its table, and the roster says where each vendor stands** (T318, [the roster states](../../../CONTEXT.md#at-the-door)).
A check-in said only that a vendor came on a date, so a vendor checked in and then freed vanished from the roster while their record stayed, and once seated again elsewhere read as checked in, with the old time, at a table they never reached (T277's report, section 4.9).
Each roster row's `state` is `expected` (a seat and no record), `here` (a record made at the seat held now, or a record with no `table_code`), `here_elsewhere` (a record made at another table, after a move or a swap) or `here_without_seat` (a record and no seat that day, after a free), and `checkedInTableCode` is the record's table (on a seated row, the seat's for a record with none); a `here_without_seat` row has `tableCode`, `tableChoice`, `section` and `location` null.
"Did not come" is the page's wording of `expected` on a day that is over on the viewer's calendar, not a state: the server cannot know the market's time zone.
The record itself is never moved: freeing, moving or swapping a vendor leaves it as it was, and the state says where they went.
Freeing, moving or swapping a vendor who has a record that day asks first: the placement doors read it (`checked_in_on`, one record by the normalised address) and answer 409 `vendor_is_here` until asked again with `whileHere: true` ([placements](placements.md)).
`check_in_counts` and the page's tally count seated rows only, so a vendor here with no table that day counts toward no day's "18/24".
[`test_a_check_in_keeps_its_table.py`](../../../back-end/tests/test_a_check_in_keeps_its_table.py) holds each state through the route, the record's table, and the free and the move that once moved it.

**A check-in or its undo holds the market's phase** (T318).
The record lives in `attendance` and the phase on the market, so no one write holds both, the race [ADR 0024](../../adr/0024-a-market-write-holds-what-it-read.md)'s last consequence leaves to compensation.
`record_attendance` and `undo_attendance` read the market themselves (`live`) and refuse outside `market_days`, archived with "This market has ended, so check-in is closed." (409) and otherwise "Vendors are checked in once the market is published." (409); then they write, and read the phase again (`_closed_since`).
A market no longer in its days by then gets the write taken back, with no history entry and the archived refusal (or "Market not found", 404, for one gone since): an inserted record deleted (held to the time this call wrote, so another call's is left to it), an updated one put back to the fields it had, a deleted one inserted again; a check-in of that day which landed in between keeps the day's one record.
So neither door's check-in nor its undo lands on a market archived a moment before, and the archived record of who came stays whole.

**Both doors keep one "today": the server's UTC date, a day either side of which is today somewhere on Earth** (`day_has_begun` and `within_the_window`, in `api/attendance.py`).
The organizer's check-in takes any market date no later than the server's UTC date plus one, so a tap missed in the rush is corrected after, and refuses a later one with 409, "That day has not begun yet, so nobody can be checked in for it." (in `record_attendance`, after the seat check); its undo takes any date.
The vendor's door keeps its window, a day either side of the server's UTC date.
The page's "today" stays the viewer's calendar day (`calendarToday`), so the page offers Check in only on a chosen date no later than it, never inviting the refusal; Undo stays wherever there is a record.

**A vendor checks themselves in only signed in, and only with the door code** ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)).
The check-in was a public page at `/<slug>/check-in`, where anyone with the market's address typed any vendor's email, read their seats and checked them in or out, so a check-in proved nothing; it, its read and its four public endpoints are gone, and answer 404.
`api/vendor_check_in.py` wants the vendor page's Bearer token (401 without), counts every try, right code or wrong, against `check-in:address` (10 in 15 minutes) by the token's address and counts nothing per caller, so a venue's shared wifi never refuses one vendor's right code for others' wrong ones, while a vendor at home cannot guess the code ([`sign_in_limits`](../../../back-end/sign_in_limits.py), beside the sign-in's own bounds in [a vendor signs in before they have applied](../../business/rules/a-vendor-signs-in-before-applying.md#sign-in-is-bounded)), and goes through the vendor page gate (`vendor_page_market_by_slug`), so a market with no vendor page answers exactly as a slug that names nothing.
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
It loads through the change loader (`_load_market_to_change`), so an archived market's record is never changed, and refuses with a 409 outside `market_days`; `record_attendance` and `undo_attendance` then hold the phase on their own reads (above).
It writes through `record_attendance`, which stamps `checked_in_by`, so the two doors record alike, and a vendor checking in again after an organizer did is no longer credited to the organizer.
`_door_write` catches nothing: a market that does not exist answers 404, an archived one or a person the row refuses 403 with its sentence, and one that cannot be read `Invalid market data`, 400, each raised by the change loader ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md)); a body that is not a JSON object is `A JSON object is required`, 400.
An organizer checking a vendor in on a past market date is not refused, and on one to come is (above).

**The roster stays fresh by itself** (T318).
It was read on load and after the organizer's own tap, so a vendor who scanned themselves in, or another organizer's check-in, showed only after this organizer's next tap or a reload, and "who is missing" was stale at exactly the moment it was asked.
Attendance reads its roster again every 15 seconds while the page is in view (`REREAD_MS`), and at once when the tab comes back into view or the browser comes back online; hidden, it reads nothing, and the clock never asks for a read while one is out.
Every read takes a number from one counter as it is asked, and its answer lands only if nothing newer was asked or landed since, so two reads answering out of order never show a vendor just checked in as not here; a dropped answer changes nothing on screen, its error included.
A check-in or its undo shows on its row from the server's answer at once (`checkedInAt` from the answer, `checkedInBy` the signed-in address and `state` `here` at the row's own table, or all three cleared and `state` `expected`; an undone row with no seat goes), counts as newer than every read in flight, and a re-read follows; each row is held busy only while its own write is out, so taps on several rows all go through.
The top row ends with [`ListFreshness`](../../../front-end/src/components/ListFreshness.vue) (`attendance-updated`, `attendance-refresh`) before Print roster and Door code: when the roster was last read, ageing on screen, and Refresh.
A re-read or a Refresh that fails keeps the rows and says "Could not update. The roster is as it was last read." on a line under the top row, until a read lands: between Refresh and Door code it pushed Door code onto a line of its own on a phone; a first read that fails is still the page that could not be read, with Try again.
There is no offline copy and no queue of taps.
`AttendanceStatusView.test.ts` holds each of these, and [`the-door-stays-fresh.spec.ts`](../../../front-end/e2e/the-door-stays-fresh.spec.ts) a vendor's own check-in showing on the open roster once `page.clock` runs 15 seconds, and a re-read that fails.

**The roster prints whole, and the door is asked to print it** (T318).
Paper is the door's only fallback when the venue's network or the back end fails, and nothing prompted the organizer to keep one.
"Print roster" (`attendance-print`) stands in the top row after Refresh, before Door code where that is offered, for anyone who reads Attendance whenever the market has dates, in every phase the page opens in, and calls `window.print()`.
[`DoorRosterPrint.vue`](../../../front-end/src/components/DoorRosterPrint.vue), rendered by Attendance and hidden on screen, is what prints: the market's name, the chosen date in words, "<N> vendors" (the date's seats, as its tally counts them), "Printed <date> at <time>" (stamped again on the window's `beforeprint`, so a print from the browser's menu is current too), then a table of every row of the date in the roster's order, by table: Table, Vendor (the name, and the address under it; the address alone when there is no name) and Here (the row's status when checked in, else an empty box to tick); the date's `here_without_seat` rows print in a second table under "Checked in, with no table on this date (<n>)".
It takes the date's rows from the roster itself, not the rows on screen, so the Show toggle and the search never leave a vendor off the paper; notes are not printed.
It is teleported to `body`, beside the app, and its print rules sit in its scoped block, as the door code's do (below); only the rule hiding the app is global, and it holds only while the door code's screen is not open, so that screen's poster still prints alone.
In Market Days, on a chosen date that is today or later on the viewer's calendar, a `.note` over the day's tally asks for it (`attendance-print-note`): "If the venue's network fails, a printed roster still works. Print this day's roster before the doors open."; on a past date or an archived market there is nothing left to print for.
[The rail](market-guide.md) asks too: "Print each day's roster, then check vendors in at the door."
`aRosterPrintsWhole.test.ts` holds the sheet with a filter and a search on, `AttendanceStatusView.test.ts` the button and when the note shows, and [`the-roster-prints.spec.ts`](../../../front-end/e2e/the-roster-prints.spec.ts) the sheet under print emulation at 1440: the app hidden, every vendor of the day with a filter on, nothing past the page's width, and a Letter and an A4 PDF whose first page opens on the market's name (read by `e2e/helpers/pdfText.ts`).

**The page words each roster state** (T318).
`here` reads as it always has, in a positive chip; `here_elsewhere` reads "<status>, at table <checkedInTableCode>" in an attention chip, so the organizer sends the vendor to their new table; `here_without_seat` rows are listed after the date's seated rows under "Checked in, with no table on this date (<n>)" (`attendance-unseated-heading`), their table "No table", their chip the status in attention, with Undo for whoever may check in.
The date's tally, its "checked in / expected" and the Show toggles count seated rows only, as the Stats tab does; a `here_without_seat` row shows under All and Checked in, never under Not yet.
`AttendanceStatusView.test.ts` holds each, and Check in offered by date.

**The page offers Check in and Undo only in Market Days, to someone who may check vendors in, Check in only on today and past days, and a row offering neither ends at its status** (`door-row--read`).
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
Making one loads through the change loader, answers 409 outside `market_days`, and writes through [the market write](market-write.md), holding the phase it was loaded in, so a market archived since it was loaded is not changed and the request answers the one 409 with [its sentence](market-write.md#what-it-answers); a new code replaces the old at once, so every poster of the old one stops working.
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
