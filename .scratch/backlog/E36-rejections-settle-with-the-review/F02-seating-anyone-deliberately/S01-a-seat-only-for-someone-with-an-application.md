---
id: E36/F02/S01
title: A seat only for someone with an application
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Placing, pinning or swapping a vendor into a seat is refused when the address has no application in the market, with a reason that names the address (decision 6).
Today the placement write checks only the date, the seat and a collision, so any typed address takes a seat, with no name, no answers and nothing in the vendor drawer.
The address is matched through the one normalised form every other lookup uses.
A vendor added by hand (`F03`) has an application, so this refusal never stands in their way.

## As built

- `has_applied` and `_applicant_address` in `api/placements.py`: a seat is written under the applicant's normalised address, and a swap asks the same of both sides.

## Acceptance criteria

- [x] A placement, pin or swap naming an address with no application in the market is refused, and nothing is written to the seats or the placement trail.
- [x] An address differing only in capitals or surrounding spaces from an applicant's is that applicant.
- [x] Every existing placement path (the dialog, the swap, the run) still seats applicants as before.
- [x] Seed helpers and specs that place an address with no application are given one.
