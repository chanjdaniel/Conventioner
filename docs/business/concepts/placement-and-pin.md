---
layer: business
kind: concept
verified: 2026-10-21
---

# Placement and pin

**Placed as** and **Table** are defined in [the glossary](../../../CONTEXT.md#placing), under Placing, beside Table code, Table type and Table choice; this node gathers what the graph says about a vendor's seat at a table, and the pin that holds one.

## Rules

- [A seat only for an applicant](../rules/a-seat-only-for-an-applicant.md): anyone with an application may be pinned, warned, and is held.
- [Adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md): seated by hand.
- [Tier filters, section prefers](../rules/tier-filters-section-prefers.md): which tables a vendor may be placed at.
- [The half-table share](../rules/half-table-share.md): how many of a section's tables go to vendors on halves.
- [The setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md): the sections and their tables are fixed once the market leaves draft.
- [Verdicts settle on entering assignment](../rules/verdicts-settle-on-entering-assignment.md): after that, a seat placed or freed by hand is how a review's mistake is fixed.
- [Why a vendor was not placed](../rules/why-a-vendor-was-not-placed.md): a vendor's date is placed, placed against their answer, or not placed and why.

## Flows

- [Placing by hand](../flows/placing-by-hand.md): placing, swapping and freeing a seat, pins, and a pin the plan no longer holds.
- [Read the result](../flows/assignment-and-result.md#j4-read-the-result): each table on each date, and who sits there.
- [Sections](../flows/planning.md#e4-sections) and [sections from a floorplan](../flows/planning.md#e6-sections-from-a-floorplan): where the tables come from.
- [A vendor looks up their table and checks in](../flows/market-day-door.md#k2-a-vendor-looks-up-their-table-and-checks-in).

## Implementation

- [Placements](../../implementation/modules/placements.md): the four doors, pins, the held seat, orphans, and `MarketTableRow`.
- [ADR 0002: A pin is a placement row](../../adr/0002-a-pin-is-a-placement-row.md).
- [The placement history](../../implementation/data/placement-history.md): every placement, freed seat and swap.
- [Floorplan placement](../../implementation/modules/floorplan-placement.md): the beta's Auto-Place, tables placed in a room.
- [Attendance and the door](../../implementation/modules/attendance-and-door.md): a check-in needs a stored placement on that date.
