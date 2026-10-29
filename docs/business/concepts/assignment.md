---
layer: business
kind: concept
verified: 2026-10-22
---

# Assignment

**Assignment** is defined in [the glossary](../../../CONTEXT.md#assigning), under Assigning, beside Assignment rules, Priority and Max assignments per vendor; this node gathers what the graph says about it.

## Rules

- [Assign runs only in assignment](../rules/assign-runs-only-in-assignment.md): the run is refused in every other phase, and once results are published.
- [An incomplete application refuses the run](../rules/an-incomplete-application-refuses-the-run.md): the run stops, naming the applicants.
- [An assignment knows when it is out of date](../rules/an-assignment-knows-when-it-is-out-of-date.md): which of the rules, the plan and the approved applications changed since it ran.
- [The assignment rules close with the assignment](../rules/the-assignment-rules-close-with-the-assignment.md): the priority and the options lock.
- [Priority and tie-breaks](../rules/priority-and-tie-breaks.md): the order of turns.
- [The ceiling on dates per vendor](../rules/max-assignments-ceiling.md): `max_assignments_per_vendor` is the only ceiling.
- [Tier filters, section prefers](../rules/tier-filters-section-prefers.md): never a tier a vendor refused.
- [Dates fill one at a time, in the plan's order](../rules/dates-fill-in-calendar-order.md).
- [The half-table share](../rules/half-table-share.md) and [table-share pairing](../rules/table-share-pairing.md): who shares a table.
- [Verdicts settle on entering assignment](../rules/verdicts-settle-on-entering-assignment.md): from then on a seat, not a verdict, is changed.
- [Adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md): seated by hand, never in the run.
- [Why a vendor was not placed](../rules/why-a-vendor-was-not-placed.md): every date with no table says why, read off the assignment as it stands.
- [Publish Results waits for the allocation](../rules/publish-results-waits-for-the-allocation.md) and [an applicant never reads a verdict early](../rules/an-applicant-never-reads-a-verdict-early.md): what applicants learn of the assignment, and when.
- [What a correct assignment is](../rules/what-a-correct-assignment-is.md): the five things a real market's result is judged by.

## Flows

- [The assignment and its result](../flows/assignment-and-result.md): the rules, the run, the result, publishing results.
- [Placing by hand](../flows/placing-by-hand.md): placing, swapping and freeing a seat after the run.
- [Begin assignment](../flows/review.md#i5-begin-assignment): the move into the Assignment phase.
- [Vendors](../flows/vendors.md): what each vendor got, and why a date was not given.
- [The vendor drawer](../flows/vendor-drawer.md): one vendor's assignments.

## Implementation

- [The assignment solver](../../implementation/modules/assignment-solver.md): `assign_market` over the approved applications.
- [Placements](../../implementation/modules/placements.md): the one writer of the stored assignment.
- [What an assignment was made from](../../implementation/modules/made-from.md): the fingerprints a run records.
- [The market's history](../../implementation/data/history.md): who changed the assignment, to what, and when.
- [ADR 0002: A pin is a placement row](../../adr/0002-a-pin-is-a-placement-row.md).
- [ADR 0003: Applications are the solver's only input](../../adr/0003-applications-are-the-solvers-only-input.md).
- [ADR 0004: A priority rule names a target](../../adr/0004-a-priority-rule-names-a-target.md).
- [ADR 0013: Verdicts settle with the review, and results settle the allocation](../../adr/0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md).
- [The assignment behaviour suite](../../implementation/testing/assignment-behaviour-suite.md): the solver's rules, pinned case by case.
