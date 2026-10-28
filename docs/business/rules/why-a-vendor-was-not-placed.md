---
layer: business
kind: rule
describes:
  - back-end/placement_reasons.py#PlacementReason
  - back-end/placement_reasons.py#unplaced_dates
  - back-end/placement_reasons.py#_reason_for
  - back-end/guards.py#NoAskedForTierWithoutTablesGuard
  - front-end/src/utils/placementReason.ts
  - front-end/src/components/VendorDateCard.vue
verified: 2026-10-28
sources:
  - wayfinding/readable-journey/04
  - wayfinding/readable-journey/map
  - E12
  - E12/F01/S01
  - E12/F03/S02
  - E31/F01/S01
  - bug/33
---

# Why a vendor was not placed

Every date a vendor holds no table on says why, worked out from the plan, their answers and the placements as they stand at the moment it is read, never recorded by the run.
A vendor partly placed is told too: each date they missed has its own reason.

**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

## Why

**A reason recorded during the run goes stale**, the moment the plan changes or a seat is changed by hand: a vendor recorded as "every table was taken" who now faces a free seat, because someone was moved, would be told something false.
A reason read off the current state is always true, and it can say the one thing a recorded reason never could: a table they accept is free, and they could be placed now.
It also leaves the solver alone: nothing in the run records anything, and nothing here runs it.

**The reasons are a closed set**, asked in the order an organizer would ask them:

1. Not available: they did not offer that date.
2. At their limit: they already hold as many dates as they asked for.
3. At the market's ceiling: they already hold as many dates as the market allows one vendor ([the ceiling on dates per vendor](max-assignments-ceiling.md)).
4. No table at a tier they accept: the plan has no tables at any tier they named for that date.
5. Taken: tables they accept exist that day, and every one is occupied.
6. Free: a table they accept is open that day (a half table counts for a vendor who would share).

The limits come before the tables because they are where the solver stopped: a vendor with every date they asked for is left off the rest however many tables are free, and calling such a date free invited the organizer to break the limit (bug 33).
Their own answer is named when it is the lower of the two limits, since it is the one they gave.

**The reason is a value, and the words are the screen's**, so a sentence changes without a migration or a back-end release.

**Only "free" is something to do.**
It offers "Place them", which opens the Result page on that date searched for the vendor; every other reason is a report whose answer is in the plan or in the vendor's own answers.

**One card says what happened to a vendor on a date**, in one of three states: placed, placed against their own answer (a hand placement at a tier, date or table size they did not ask for, or for someone not approved), or not placed and why.
The mark on a placement that overrides an answer is that card's second state, not a feature of its own; it is in [placements](../../implementation/modules/placements.md#pins).

**A tier with no tables never reaches the run.**
Tables come from sections and a section carries one tier, so a tier with no section has no tables on any date, which the plan alone shows.
Market Setup marks such a tier "No tables" while it is built, leaving draft refuses it ([the setup settles on leaving draft](the-setup-settles-on-leaving-draft.md)), and the move into assignment refuses one an approved applicant named, naming the tier and the applicants, since both fixes (a section at that tier, or rejecting them) act on a named thing.

## Where it is kept

- `unplaced_dates` and `_reason_for` in [`back-end/placement_reasons.py`](../../../back-end/placement_reasons.py) work out every `(vendor, date)` with no table and its `PlacementReason`, from the placements passed in; [placements](../../implementation/modules/placements.md) describes the stored assignment they read.
- The assignment statistics serve them as `unplacedDates`, beside `overriddenPlacements` and `vendorNames`.
- [`front-end/src/utils/placementReason.ts`](../../../front-end/src/utils/placementReason.ts) holds the words and which reason is actionable, and [`front-end/src/components/VendorDateCard.vue`](../../../front-end/src/components/VendorDateCard.vue) is the card, on the vendor drawer's Assignments tab ([find out why a vendor was not placed](../flows/vendors.md#j12-find-out-why-a-vendor-was-not-placed)).
- `NoAskedForTierWithoutTablesGuard` in [`back-end/guards.py`](../../../back-end/guards.py) is the refusal on `review -> assignment`, kept by [the guards](../../implementation/modules/guards.md).
- `back-end/tests/test_placement_reasons.py` and `front-end/src/__tests__/vendorDateCard.test.ts` pin it.

## Superseded

- An empty tier was to be harmless until an approved applicant named it, marked in the plan editor and refused only on entering assignment (wayfinding/readable-journey/04); leaving draft now refuses any tier with no tables, so on a market planned through the product the refusal on entering assignment meets only a plan changed outside it (E31/F01/S01).

## Evidence

The walk that asked for this had five approved applications, three placed, nineteen of twenty-four table slots free and two vendors unplaced with nothing on screen saying why: both had asked for a tier the market had no sections at (wayfinding/readable-journey/map).
Every check the solver makes on a vendor (the date offered, the limits, the tier on that date) reads their answers, the plan and the placements already made, and table choice decides only who shares a table once one is chosen, which is why every reason can be worked out after the run with no change to the solver (`is_valid_vendor` in `back-end/assignment/assignment.py`).
