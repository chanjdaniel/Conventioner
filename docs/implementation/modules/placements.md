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
  - back-end/placement_reasons.py#overridden_placements
  - back-end/guards.py#NoOrphanedPinGuard
  - back-end/api/markets.py#assignment_to_show
  - back-end/api/markets.py#derive_unassigned_tables_from_rows
  - back-end/assignment/assignment.py#vendors_to_show
verified: 2026-11-11
sources:
  - wayfinding/readable-journey/08
  - wayfinding/claims-and-room/map
  - wayfinding/readable-journey/04
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
  - E30/F01/S01
  - E44/F01/S01
  - E44/F01/S02
  - T139
  - T142
  - T208
  - T213
  - T224
  - T253
  - T263
  - T270
---

# Placements

Who sits where, stored once on the market and written by one module.
[`back-end/api/placements.py`](../../../back-end/api/placements.py) is the only writer of `assignmentObject` ([the market document](../data/market-document.md)), the stored assignment that check-in reads at the door and the organizer edits one seat at a time.
The organizer edits it on the Assignments page, which fits a phone (`meta.fitsAPhone`, [the design language](../../design-system.md#layout)): the vendor drawer's "Change assignment" at the door leads there, so a seat can be changed on the phone it was tapped on (T142).
Its routes are in [`back-end/app.py`](../../../back-end/app.py).

## The four doors

| Route                               | Function           | Does                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /markets/:id/assignment`      | `run_assignment`   | runs the solver over the approved applications and stores what it produced, with [what it was made from](made-from.md), the review the verdicts were given in among it; every vendor-day held before the run or after it forgets its freed record, and the $0 a free's deduction set on it ([payments](../data/payments.md))                                                                                         |
| `PUT /markets/:id/placements`       | `write_placement`  | places one vendor in one seat on one date, replacing whatever they held that date, so it is also the move to an empty seat, from either end of the dialog: the vendor's seat or the empty one (T208); the day forgets that vendor's freed record, and the $0 a free's deduction set on it ([payments](../data/payments.md))                                                                                          |
| `DELETE /markets/:id/placements`    | `remove_placement` | frees the seat one vendor holds on one date, first keeping the seat's line of what they owe for it, which freeing never changes ([payments](../data/payments.md)), unless `deductOwed` asks that it owe $0, which asks the row "Change the amount owed" too, before anything is freed; freeing a seat nobody holds is not an error, and with `deductOwed` sets that $0 on a freed line holding no amount set by hand |
| `POST /markets/:id/placements/swap` | `swap_placements`  | trades two vendors' seats on one date in one document update: both change or neither does; both days forget any freed record a stopped free left on them                                                                                                                                                                                                                                                             |

**A run whose allocation breaks the solver's rules is refused before the store.**
`assign_market` raises `BrokenAllocationError` before `run_assignment` stores anything ([the assignment solver](assignment-solver.md#sharp-edges)), so nothing is written, no history entry is recorded and no payment changes; the organizer reads the generic failure line.

**A free writes what the vendor owes before the seat, in one write.**
`remove_placement`, for a seat held, writes in this order ([payments](../data/payments.md#the-amount-owed-per-table-day)):

1. One upsert on the day's owed record keeps the freed line and, when `deductOwed` asked it, the free's $0 (`PaymentsApi.keep_freed_line`).
2. The seat is freed (`_store_vendor_assignments`).
3. When step 2 is refused by the revision, the record goes back as it held before, only while it still holds what step 1 wrote, and the error goes on.
   When it raises anything else, which may come after the store reached the database, the record goes back that way only while the stored assignment still seats the vendor that day; when that cannot be read, the line stays, since a held seat reads its own price over it.
4. The freed entry is recorded, and with the deduction an "owed set" entry from what the line owed as the request read it, while the seat was held, to 0.

So no stop after the seat leaves it free and its full amount owed, no seat write that landed before its error loses the day's line, and no seat write refused, or failed with the seat read as still held, leaves a freed record behind; one that failed with the seat unread leaves its line, read over by the held seat until the next write of the day forgets it.

**Every write of the assignment hands `seated_again` the days it touched, after its store.**
A placement hands its vendor's day, a swap its two vendors' day, and a run every day held in the assignment it read and every day held in the one it wrote.
Each also hands the days held in the assignment it read: a freed record on such a day is one a stopped free left, cleared with no history entry, and only a day not held there, which really read as freed, records "owed taken back".

**All four ask the table's Assignment row** ([the market's actions](market-actions.md)), whose default is EDITOR, the bar every other market write sets, and deliberately not stricter: an EDITOR already owns the tiers, sections and table counts the whole assignment is computed from, so withholding "move one vendor between two seats" protects nothing.
Each loads its market through `_load_market_to_change`, so an archived market is refused.
A placement that names no seat the plan has is a `PlacementError` (400); a seat someone else holds is a `SeatTakenError` (409), naming the occupant; a run outside its phase is an `AssignPhaseError` (409); a change that would land over another is an `AssignmentChangedUnderRequest` (409), below.
Each is a [client error](../conventions/an-exception-never-reaches-a-client.md) carrying that status.
The routes catch nothing: each refusal reaches the handler with its own status and copy, and anything else answers the generic 500.
Each reads its body with `json_object` ([a body that is not an object is refused in words](../conventions/an-exception-never-reaches-a-client.md)): a body that is not a JSON object answers `A JSON object is required`, 400, a placement with no body or an empty one `No data provided`, 400, and a swap or a freed seat with none is read as empty and refused by the API in its own words; a swap whose `emails` is not a list names no vendor, and is refused as such.

**There is no other door.**
The whole-market PUT that once let a stale client copy move vendors on market day is deleted ([ADR 0008](../../adr/0008-each-write-names-what-it-changes.md)).
`seedAssignedMarket` stores an assignment through `POST /markets/:id/assignment` too, after walking the market to `assignment` ([assign runs only in assignment](../../business/rules/assign-runs-only-in-assignment.md)); only `seedStoredAssignment`, for the phase machine's specs, writes rows straight into Mongo, since those specs are about the phase machine rather than placement.

**No change displaces an occupant.**
A move into an empty seat displaces nobody, so it is allowed, as one write: `write_placement` replaces the seat the vendor held that date, and its history entry names the table left.
Placing into a taken seat is still refused while the organizer can see both vendors, and trading two seated vendors is still the swap, which says out loud that two people are changing places.
A swap is atomic because three separate operations invite a half-finished state, and the half-finished state is a vendor standing at no table on market day.

**No change lands over another.**
Each of the four reads the whole assignment and writes it back whole (`_store_vendor_assignments`), so two changes at once would each store the assignment as it was before the other, and one would be lost without a word: two organizers moving two vendors into one empty seat both got a 200, and only one was seated, while the history recorded both moves.
So the write lands only while `assignmentObject.revision` is still the one the change read, and counts it one more; otherwise it is refused, `AssignmentChangedUnderRequest` (409), "Someone else changed this market's tables while this change was being saved, so it was not saved. Reload the tables and try again.", before any history or payments line is recorded.
An assignment stored before the count existed has none, and reads as 0.
A free refused this way puts back what it kept for the seat, its line and any $0 it set, unless a free of the same seat landed meanwhile and kept its own ([payments](../data/payments.md)).

**A seat goes only to an applicant.**
`write_placement` writes the applicant's normalised address, and a placement or a swap naming someone the market has no application for is refused (`has_applied`, `_applicant_address`): [a seat only for an applicant](../../business/rules/a-seat-only-for-an-applicant.md).
A vendor who never applied is first [added by hand](../../business/rules/adding-a-vendor-who-never-applied.md), which gives them an application.

## Pins

**A pin is a placement row**, a `VendorAssignmentResult` flagged `hand_placed` ([ADR 0002](../../adr/0002-a-pin-is-a-placement-row.md)); every hand placement and both sides of a swap are flagged.
`assign_market` reads the market's own stored flagged rows and seats them first (`MarketAssignment._seat_pins` in [`back-end/assignment/assignment.py`](../../../back-end/assignment/assignment.py)), so the ordinary loop sees those tables occupied.
A pinned vendor counts against their own ceiling and the section's half-table share, because they occupy a real seat on a real date.

**An applicant outside the run is seated as held.**
A pin for someone the run does not place (an applicant the review did not approve, or a vendor added by hand) is seated from `held_vendors_for` (`held_solver_vendors` in [`back-end/assignment/vendor_input.py`](../../../back-end/assignment/vendor_input.py)), read leniently since no answer of theirs decides anything.
The seat is occupied, they are placed nowhere else, and the solver never counts them among the run's vendors; the statistics the Assignments page reads then count a vendor added by hand among the vendors who need a table, seated or not, and never a not-approved one (`count_added_vendors` in [`back-end/api/markets.py`](../../../back-end/api/markets.py), [adding a vendor who never applied](../../business/rules/adding-a-vendor-who-never-applied.md)).

**A pin that overrides an answer stands, and is marked.**
`overridden_placements` in [`back-end/placement_reasons.py`](../../../back-end/placement_reasons.py) compares every hand placement with the vendor's answers as the organizer reads them (an organizer's update included) when the statistics are read, never when the pin is made: someone the review left out of the run first, then a date they did not offer, a tier they did not accept on a date they did offer (the one that costs money, since tier sets the price), and a table size they did not ask for.
A solver row is never compared, since the run never contradicts an answer.
The statistics serve the list as `overriddenPlacements`, and it is the second of the vendor date card's three states ([why a vendor was not placed](../../business/rules/why-a-vendor-was-not-placed.md)).

**A pin the plan can no longer hold is orphaned, never deleted.**
Deleting the section a pinned seat belongs to, or dropping its table count below the pin, leaves the row in place (`orphaned_pins` in [`back-end/placement_reasons.py`](../../../back-end/placement_reasons.py)).
`NoOrphanedPinGuard` in [`back-end/guards.py`](../../../back-end/guards.py) refuses the moves into `assignment` and into `market_days` until the seat is restored to the plan or the vendor is moved or freed, naming each vendor and seat.
The market read serves the same list as `orphanedPins`, for the Assignments page and the vendor's panel to mark (bug 31).
The solver keeps an orphaned pin's vendor on the date it claimed, at that pin and nowhere else, rather than quietly placing them elsewhere; the pin stays their seat for the statistics, the Vendors list and the export alike.

## What a read shows

**Read-only views describe the stored assignment, and only that.**
`assignment_to_show` in [`back-end/api/markets.py`](../../../back-end/api/markets.py) is `describe_stored_assignment`, which seats the stored rows and derives statistics without running the solver.
The statistics, the tables grid, the CSV and the Stats tab's placement headlines all go through it, which is what keeps them describing the same market.
They read the approved applications with `vendors_to_show`, never the run's `solver_vendors_for`: a read places nobody, so an approved application missing an answer refuses nothing, and is counted and seated as stored (T139).
Only a run, and the preview below, refuse it ([an incomplete application refuses the run](../../business/rules/an-incomplete-application-refuses-the-run.md)).
The Assignments page's strip and the Stats tab's placement headlines are one count, `counted_assignment` in the same file, with `table_days_free` beside it counting the grid's "Empty" rows ([the market's statistics](../../business/flows/stats.md#n1-see-the-markets-state-at-a-glance)).
A market with nothing stored is shown nobody placed, never the run it would get (E31/F03/S05): that preview once read "197 of 197 vendors assigned" before anyone pressed Assign.
`GET /markets/:id/assignment` is the one preview: VIEWER, it computes a run over the approved applications and stores nothing, with the stored rows (and so the pins) left out.
That it recomputes while every other read serves the stored assignment is deliberate: a preview answers "what would Assign give me", and the point of `assignment_to_show` is that nothing else recomputes.
No screen calls it; `section-preference.spec.ts` does.
It and the run's own response dump the whole market, less every answer `exampleColumns` keeps for an option to offer (`leave_out_every_answer`, [ADR 0023](../../adr/0023-every-answer-for-an-option-to-offer.md)).

**`MarketTableRow.assignment` is the occupants and nothing else.**
Its length is what `derive_unassigned_tables_from_rows` reads to count spare capacity.
Which side of a table is free lives in `assignment_slots` (`[left, right]`, None for vacant), because one address in a list of one says somebody is there, not which half they sit at.
Do not conflate them; see `MarketTableRow` in [`back-end/datatypes.py`](../../../back-end/datatypes.py), beside `VendorAssignmentResult` and `AssignmentObject`.

**Statistics are never stored.**
A write sets `vendorAssignments`, `assignmentDate` and, for a run alone, `madeFrom`, counts `assignmentObject.revision` one up, and clears `assignmentStatistics`, so a stale copy is never resurrected.

## The trail

Every change here is recorded in [the market's history](../data/history.md), under the `assign` action: a placement, a freed seat, a swap, and a solver run as one entry, with how many placements it wrote and how many pins it kept.

## Why

- [Assign runs only in assignment](../../business/rules/assign-runs-only-in-assignment.md): `assign_phase_refusal`, and after results are published `assign_refusal`, served as `assignRefusalReason`.
- [A seat only for an applicant](../../business/rules/a-seat-only-for-an-applicant.md), and anyone may be pinned, warned.
- [Adding a vendor who never applied](../../business/rules/adding-a-vendor-who-never-applied.md): seated here, by hand, as a held pin.
- [An assignment knows when it is out of date](../../business/rules/an-assignment-knows-when-it-is-out-of-date.md): only a run records what it was made from ([made from](made-from.md)).
- [A pin is a placement row](../../adr/0002-a-pin-is-a-placement-row.md).
- [Verdicts settle on entering assignment](../../business/rules/verdicts-settle-on-entering-assignment.md): from then on a seat placed or freed here, not a verdict, is how a review's mistake is fixed.
- [An incomplete application refuses the run](../../business/rules/an-incomplete-application-refuses-the-run.md): `run_assignment` answers it with the applicants and what each lacks.
- [The half-table share](../../business/rules/half-table-share.md): a pin on half a table counts against it.
- [Why a vendor was not placed](../../business/rules/why-a-vendor-was-not-placed.md): each date with no table says why, read off the placements stored here, and a pin that overrides an answer is marked.

The organizer places, moves, swaps and frees seats through these doors in [placing by hand](../../business/flows/placing-by-hand.md).

The glossary concepts it serves: [Assignment](../../business/concepts/assignment.md) and [Placement and pin](../../business/concepts/placement-and-pin.md).
