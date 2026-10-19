---
id: E35/F01/S02
title: A seat and an attendance entry open the drawer
type: story
status: in-progress
blocked_by: [E35/F01/S01]
pr: []
---

## What to build

- **Results, tables view**: the vendor's name on a table card opens the drawer, and the seat modal gets a "View vendor" button.
- **Attendance**: the vendor's name opens the drawer; check-in stays its own large target, and opening the drawer never checks anyone in. A row shows the vendor's notes only when there are some, and a first note is added from the drawer.

Both work at phone width on Attendance.

## As built

- `components/VendorNameButton.vue` is a vendor's name that opens their drawer, on a seat and at the door.
- A held seat (`ResultSeat`) is two controls in one box: the name, and Change in the corner where the hint was (`tables-seat-change`).
  A button cannot hold another, so the seat is no longer one button; a free seat still is, and a record seat keeps the name alone.
- The placement dialog's occupied view has View vendor, which closes the dialog and opens the drawer.
- The Result page and Attendance host the drawer, with the open vendor in the address as on Vendors.
  A placement change on the Result page reads the drawer's vendors again.
- At the door, the drawer's notes changing re-reads the row's, so a first note shows under the row.
- The Result page's link from a placement still sets `?vendor=`, which now opens the drawer there; `F02/S02` moves it to the search.

## Acceptance criteria

- [x] One click on a vendor's name on a table card opens their drawer.
- [x] The seat modal's "View vendor" opens it.
- [x] On Attendance, clicking a name opens the drawer and does not check in; at 390px the name and check-in are separate targets.
- [x] A note added from the drawer opened on Attendance appears under that vendor's row.
