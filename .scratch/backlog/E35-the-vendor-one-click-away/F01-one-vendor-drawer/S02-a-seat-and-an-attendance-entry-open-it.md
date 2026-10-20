---
id: E35/F01/S02
title: A seat and an attendance entry open the drawer
type: story
status: ready
blocked_by: [E35/F01/S01]
pr: []
---

## What to build

- **Results, tables view**: the vendor's name on a table card opens the drawer, and the seat modal gets a "View vendor" button.
- **Attendance**: the vendor's name opens the drawer; check-in stays its own large target, and opening the drawer never checks anyone in. A row shows the vendor's notes only when there are some, and a first note is added from the drawer.

Both work at phone width on Attendance.

## Acceptance criteria

- [ ] One click on a vendor's name on a table card opens their drawer.
- [ ] The seat modal's "View vendor" opens it.
- [ ] On Attendance, clicking a name opens the drawer and does not check in; at 390px the name and check-in are separate targets.
- [ ] A note added from the drawer opened on Attendance appears under that vendor's row.
