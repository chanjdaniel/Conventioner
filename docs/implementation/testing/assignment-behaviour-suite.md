---
layer: implementation
kind: testing
describes:
  - back-end/tests/test_assignment_behaviour.py
  - back-end/tests/test_solver_vendor_input.py
verified: 2026-10-22
sources:
  - E02/F01/S02
---

# The assignment behaviour suite

[`back-end/tests/test_assignment_behaviour.py`](../../../back-end/tests/test_assignment_behaviour.py) is the solver's behavioural suite: what [the assignment solver](../modules/assignment-solver.md) actually does, stated in terms of what vendors want.
Before E02 the solver had none, since `assign_market` was monkeypatched away everywhere, so no diff that moved placement had a witness to the old behaviour.

**Any change to placement is made against this suite, not beside it**: write the new behaviour as a case here first, and let a case that changes say so in the diff.

The glossary concepts: [Assignment](../../business/concepts/assignment.md) and [Table sharing](../../business/concepts/table-sharing.md).

## How a case is written

- `VendorWant` describes one vendor in the domain's terms (dates they can attend, tiers they accept, flat or per date, table choice, partner, a personal limit, a section ranking) and becomes a `SolverVendor`; no application, no database.
- `market_for` builds the plan (two dates, a Gold and a Silver section of two tables each, a ceiling of four, a half-table share of 100% unless a case says otherwise), and `assign(wants, pins=, held=, ...)` runs `assign_market` over it.
- `pin` writes a hand-placed row, which is all a pin is; `placements`, `seat_of` and `dates_for` read the result.
- A case about the market's own applications appends documents to the `applications` fixture of `tests/conftest.py`, the fake collection every back-end test runs on, rather than reaching Mongo.

## What it pins

Each class is one rule, named as a sentence: a vendor gets only what they asked for; tier is a filter only when asked; the ceiling on dates, the organizer's and the vendor's own, and no personal limit; how a table is occupied; table-share requests; capacity; the statistics and the satisfaction score; assigning from the market's own approved applications, a placement dated by the market date; no vendor stranded behind a table they could not take; an incomplete application stops the run; the organizer's priority rules, first come first served, most constrained first among equals, ordering by magnitude; section preference; the same market assigns the same way twice; the solver works around pins; a seat held by hand; describing what is stored.

The rules these cases keep: [priority and tie-breaks](../../business/rules/priority-and-tie-breaks.md), [tier filters, section prefers](../../business/rules/tier-filters-section-prefers.md), [table-share pairing](../../business/rules/table-share-pairing.md), [the half-table share](../../business/rules/half-table-share.md), [the ceiling on dates per vendor](../../business/rules/max-assignments-ceiling.md), [an incomplete application refuses the run](../../business/rules/an-incomplete-application-refuses-the-run.md), [what an import may leave unasked](../../business/rules/what-an-import-may-leave-unasked.md), and [dates fill one at a time, in the plan's order](../../business/rules/dates-fill-in-calendar-order.md).

## Beside it

- [`back-end/tests/test_solver_vendor_input.py`](../../../back-end/tests/test_solver_vendor_input.py) proves the seam, an application translated into a `SolverVendor`, with no `MarketAssignment` and no database.
- `test_table_share_notice.py` pins the review screen's side of table sharing; `test_the_result_knows_what_it_was_made_from.py` the fingerprints ([made from](../modules/made-from.md)); `test_essential_fields.py` the contract ([essential fields](../modules/essential-fields.md)).

## Sharp edges

**The default half-table share is not pinned.**
Every case names its share (100% unless it is about the share), so the 30% that an unset share runs at is stated only by the code.
