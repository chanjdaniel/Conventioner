---
layer: implementation
kind: module
describes:
  - back-end/api/placements.py
  - back-end/app.py#run_assignment
  - back-end/app.py#write_placement
  - back-end/app.py#remove_placement
  - back-end/app.py#swap_placements
  - back-end/datatypes.py#VendorAssignmentResult
  - back-end/datatypes.py#AssignmentObject
  - back-end/datatypes.py#MarketTableRow
  - back-end/assignment/assignment.py#MarketAssignment._seat_pins
  - back-end/assignment/assignment.py#describe_stored_assignment
  - back-end/assignment/assignment.py#held_vendors_for
  - back-end/assignment/vendor_input.py#held_solver_vendors
  - back-end/placement_reasons.py#orphaned_pins
  - back-end/guards.py#NoOrphanedPinGuard
  - back-end/api/markets.py#assignment_to_show
  - back-end/api/markets.py#derive_unassigned_tables_from_rows
verified: 2026-10-22
sources:
  - wayfinding/readable-journey/08
  - E10/F03/S02
  - E11
  - E11/F01/S01
  - E11/F02/S01
  - E11/F02/S02
  - E11/F03/S01
  - E21/F03/S06
  - E31/F03/S05
  - E36/F02/S01
  - E36/F02/S02
  - E36/F04/S02
  - bug/31
---

# Placements

Who sits where, stored once on the market and written by one module.
[`back-end/api/placements.py`](../../../back-end/api/placements.py) is the only writer of `assignmentObject` ([the market document](../data/market-document.md)), the stored assignment that check-in reads at the door and the organizer edits one seat at a time.
Its routes are in [`back-end/app.py`](../../../back-end/app.py).

## The four doors

| Route | Function | Does |
| --- | --- | --- |
| `POST /markets/:id/assignment` | `run_assignment` | runs the solver over the approved applications and stores what it produced, with [what it was made from](made-from.md) |
| `PUT /markets/:id/placements` | `write_placement` | places one vendor in one seat on one date, replacing whatever they held that date |
| `DELETE /markets/:id/placements` | `remove_placement` | frees the seat one vendor holds on one date; freeing a seat nobody holds is not an error |
| `POST /markets/:id/placements/swap` | `swap_placements` | trades two vendors' seats on one date in one document update: both change or neither does |

**All four are gated on `MarketRole.EDITOR`**, the bar every other market write sets, and deliberately not stricter: an EDITOR already owns the tiers, sections and table counts the whole assignment is computed from, so withholding "move one vendor between two seats" protects nothing.
Each loads its market through `_load_market_to_change`, so an archived market is refused.
A placement that names no seat the plan has is a `PlacementError` (400); a seat someone else holds is a `SeatTakenError` (409), naming the occupant; a run outside its phase is an `AssignPhaseError` (409).

**There is no other door.**
The whole-market PUT that once let a stale client copy move vendors on market day is deleted ([ADR 0008](../../adr/0008-each-write-names-what-it-changes.md)).
Seeds and specs store an assignment through `POST /markets/:id/assignment` too, after walking the market to `assignment` ([assign runs only in assignment](../../business/rules/assign-runs-only-in-assignment.md)).

**No "move" displaces an occupant.**
Placing into a taken seat is refused while the organizer can see both vendors; freeing a seat first mirrors what an organizer physically does, and a swap says out loud that two people are changing places.
A swap is atomic because three separate operations invite a half-finished state, and the half-finished state is a vendor standing at no table on market day.

**A seat goes only to an applicant.**
`write_placement` writes the applicant's normalised address, and a placement or a swap naming someone the market has no application for is refused (`has_applied`, `_applicant_address`): [a seat only for an applicant](../../business/rules/a-seat-only-for-an-applicant.md).
A vendor who never applied is first [added by hand](../../business/rules/adding-a-vendor-who-never-applied.md), which gives them an application.

## Pins

**A pin is a placement row**, a `VendorAssignmentResult` flagged `hand_placed` ([ADR 0002](../../adr/0002-a-pin-is-a-placement-row.md)); every hand placement and both sides of a swap are flagged.
`assign_market` reads the market's own stored flagged rows and seats them first (`MarketAssignment._seat_pins` in [`back-end/assignment/assignment.py`](../../../back-end/assignment/assignment.py)), so the ordinary loop sees those tables occupied.
A pinned vendor counts against their own ceiling and the section's half-table share, because they occupy a real seat on a real date.

**An applicant outside the run is seated as held.**
A pin for someone the run does not place (an applicant the review did not approve, or a vendor added by hand) is seated from `held_vendors_for` (`held_solver_vendors` in [`back-end/assignment/vendor_input.py`](../../../back-end/assignment/vendor_input.py)), read leniently since no answer of theirs decides anything.
The seat is occupied, they are placed nowhere else, and they are never counted among the run's vendors in the statistics.

**A pin the plan can no longer hold is orphaned, never deleted.**
Deleting the section a pinned seat belongs to, or dropping its table count below the pin, leaves the row in place (`orphaned_pins` in [`back-end/placement_reasons.py`](../../../back-end/placement_reasons.py)).
`NoOrphanedPinGuard` in [`back-end/guards.py`](../../../back-end/guards.py) refuses the moves into `assignment` and into `market_days` until the seat is restored to the plan or the vendor is moved or freed, naming each vendor and seat.
The market read serves the same list as `orphanedPins`, for the Result page and the vendor's panel to mark (bug 31).
The solver keeps an orphaned pin's vendor on the date it claimed, seated nowhere, rather than quietly placing them elsewhere.

## What a read shows

**Read-only views describe the stored assignment, and only that.**
`assignment_to_show` in [`back-end/api/markets.py`](../../../back-end/api/markets.py) is `describe_stored_assignment`, which seats the stored rows and derives statistics without running the solver.
The statistics, the tables grid and the CSV all go through it, which is what keeps them describing the same market.
A market with nothing stored is shown nobody placed, never the run it would get (E31/F03/S05): that preview once read "197 of 197 vendors assigned" before anyone pressed Assign.
`GET /markets/:id/assignment` is the one preview: VIEWER, it computes a run over the approved applications and stores nothing, with the stored rows (and so the pins) left out.
No screen calls it; `section-preference.spec.ts` does.

**`MarketTableRow.assignment` is the occupants and nothing else.**
Its length is what `derive_unassigned_tables_from_rows` reads to count spare capacity.
Which side of a table is free lives in `assignment_slots` (`[left, right]`, None for vacant), because one address in a list of one says somebody is there, not which half they sit at.
Do not conflate them; see `MarketTableRow` in [`back-end/datatypes.py`](../../../back-end/datatypes.py), beside `VendorAssignmentResult` and `AssignmentObject`.

**Statistics are never stored.**
A write sets `vendorAssignments`, `assignmentDate` and, for a run alone, `madeFrom`, and clears `assignmentStatistics`, so a stale copy is never resurrected.

## The trail

Every change here is recorded in [the placement history](../data/placement-history.md): a placement, a freed seat, a swap, and a solver run as one entry, with how many placements it wrote and how many pins it kept.

## Why

- [Assign runs only in assignment](../../business/rules/assign-runs-only-in-assignment.md): `assign_phase_refusal`, and after results are published `assign_refusal`, served as `assignRefusalReason`.
- [A seat only for an applicant](../../business/rules/a-seat-only-for-an-applicant.md), and anyone may be pinned, warned.
- [Adding a vendor who never applied](../../business/rules/adding-a-vendor-who-never-applied.md): seated here, by hand, as a held pin.
- [An assignment knows when it is out of date](../../business/rules/an-assignment-knows-when-it-is-out-of-date.md): only a run records what it was made from ([made from](made-from.md)).
- [A pin is a placement row](../../adr/0002-a-pin-is-a-placement-row.md).
