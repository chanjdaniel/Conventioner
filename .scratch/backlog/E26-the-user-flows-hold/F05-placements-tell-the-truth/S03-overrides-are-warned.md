---
id: E26/F05/S03
title: Overrides are warned before they happen
type: story
status: done
blocked_by: []
pr: [88]
---


## What to build

Placing and swapping warn, for each vendor affected, when the change crosses a tier they refused, a date they did not offer, their table choice, their own date limit or the market ceiling.
Settles `claims-and-room` 05.

Closes bugs 18, 32 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] Each override kind produces its warning in the place dialog.
- [x] The swap dialog warns for both vendors.
- [x] Warnings never block the change.
