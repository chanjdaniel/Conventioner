---
layer: business
kind: rule
describes:
  - back-end/assignment/assignment.py#MarketAssignment.market_max_assignments
  - back-end/assignment/assignment.py#MarketAssignment.max_assignments_for
  - front-end/src/components/elements/ElementAssignmentOptions.vue
verified: 2026-10-22
sources:
  - wayfinding/v0-1-0/02
  - E02
  - E26/F02/S03
---

# The ceiling on dates per vendor

The organizer's "max assignments per vendor" (`max_assignments_per_vendor`) is the only ceiling on how many dates one vendor is given.
Unset means the organizer named no ceiling, and there is no hidden default standing in for one.

A vendor is given dates up to the lower of the organizer's ceiling and their own answer to "Number of dates you want", and never more than the dates they can attend.
With neither a ceiling nor a personal limit ([what an import may leave unasked](what-an-import-may-leave-unasked.md)), they may take every date they can attend.
A pinned vendor's pins count against their own ceiling, since each occupies a real date.

**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

## Why

A hard-coded `MAX_VENDING_DAYS = 4` used to win everywhere: the screen rendered the setting, clamped it to the market's date count and saved it, and the solver never read it, so an organizer could set six, watch it save, and get four.
The constant is gone, and nothing replaces it, because a number nobody chose is not a ceiling the market has.
A market whose organizer named none is bounded by what each vendor asked for and the dates they can attend, both real answers.

## Where it is kept

- `market_max_assignments` and `max_assignments_for` in [`back-end/assignment/assignment.py`](../../../back-end/assignment/assignment.py); the module is [the assignment solver](../../implementation/modules/assignment-solver.md).
- The setting is on the Assignment tab, [`ElementAssignmentOptions.vue`](../../../front-end/src/components/elements/ElementAssignmentOptions.vue), clamped there to the market's date count; anything typed below one is stored as unset, because the solver honours a stored zero literally and would place nobody.
  A plan started from a CSV may propose a ceiling.
- Once the market can no longer reach `assignment`, it locks with the other assignment rules ([the assignment rules close with the assignment](the-assignment-rules-close-with-the-assignment.md)).
- The cases are `TestTheCapOnHowManyDates` and `TestTheOrganizersCapOnAssignmentsPerVendor` in [the assignment behaviour suite](../../implementation/testing/assignment-behaviour-suite.md).
