---
layer: implementation
kind: adr
describes:
  - back-end/datatypes.py#VendorAssignmentResult
verified: 2026-10-22
sources:
  - wayfinding/readable-journey/08
  - E11
  - E11/F02/S01
  - E11/F02/S02
status: accepted
---

# A pin is a placement row

## Context

An organizer sometimes has to guarantee a vendor a certain seat: a sponsor, a late arrangement, an accessibility need, or a repair on market day.
So a hand placement is not only an edit to a result; it is a constraint the solver must honour on every later run, rather than lose to.
A re-run that recomputed the assignment wholesale would silently discard every hand edit made before it.

The obvious model keeps the two apart: a set of `(vendor, date, table, side)` constraints beside `vendorAssignments`, which stays pure solver output.

## Decision

A pin **is** a placement: a `VendorAssignmentResult` row in the market's stored assignment, flagged `hand_placed` (`VendorAssignmentResult` in [`back-end/datatypes.py`](../../back-end/datatypes.py)).
There is no separate constraint object.
Pinning before any run is writing that row early; a run reads the stored flagged rows, seats them before anyone else, and places everyone else around them.

Two records could disagree, and the failure of disagreement is a vendor pinned to one table and placed at another, which is the exact bug pins exist to prevent.

## Consequences

- A pin is always to an exact seat, a table and a side on a date.
  "This vendor somewhere in Front Row" cannot be said; the looser form would need the two-object model, and is not worth it.
- Two vendors pinned to one seat on one date is refused when the second pin is made, while the organizer can see both, not weighed by the solver.
- A pin that breaks a vendor's own answers (a tier they did not accept, a half table for a full-table vendor) stands, and is marked as overriding what they asked for, since tier sets the price.
- A pin the plan can no longer hold is orphaned, never deleted, and blocks the next move into `assignment` or `market_days` until it is re-placed or freed.
- Every hand placement and both sides of a swap are flagged, so a re-run keeps them all.
- The single writer, the held seat and the orphan check are described in [placements](../implementation/modules/placements.md); the trail of who pinned whom is [the placement history](../implementation/data/placement-history.md).
