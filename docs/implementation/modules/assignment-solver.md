---
layer: implementation
kind: module
describes:
  - back-end/assignment/assignment.py
  - back-end/assignment/vendor_input.py
  - back-end/assignment/csv_output.py
verified: 2026-10-22
sources:
  - wayfinding/v0-1-0/02
  - E02
  - E02/F01/S02
  - E02/F04
  - E01/F05
  - E27
  - bug/23
---

# The assignment solver

The solver decides who sits at which table on which date, from the market's plan and its approved applications.
[`back-end/assignment/assignment.py`](../../../back-end/assignment/assignment.py) runs it; [`back-end/assignment/vendor_input.py`](../../../back-end/assignment/vendor_input.py) is what it reads; [`back-end/assignment/csv_output.py`](../../../back-end/assignment/csv_output.py) turns a stored assignment into the CSV an organizer downloads.
Storing a run, and every hand edit to one, is [placements](placements.md); what a run was made from is [made from](made-from.md).

## Its interface

- `assign_market(market, vendors=None, held=None)`: runs the solver over the market's own approved applications and returns the market with its `assignmentObject` filled; it stores nothing.
  A caller may pass the vendors in (the behavioural suite does, to describe a scenario with no database), but no caller has to fetch anything first.
- `solver_vendors_for(market)`: the vendors the approved applications describe, or `IncompleteApplicationsError` naming every applicant whose answers are missing ([an incomplete application refuses the run](../../business/rules/an-incomplete-application-refuses-the-run.md)).
- `describe_stored_assignment(market)`: seats the stored rows and derives statistics without running `assign()`; every read-only view goes through it ([placements](placements.md#what-a-read-shows)).
- `SolverVendor` (`vendor_input.py`): one vendor as the solver sees them, a frozen dataclass of what they asked for; `Vendor` (`assignment.py`) wraps it with one run's working state.

## Sharp edges

**There is no spreadsheet behind a market.**
E02 removed `source_data`, its endpoints and its collection, every `col_name`/`col_name_idx`/`col_names`/`col_values`/`col_include`, and `enum_priority_order` ([applications are the solver's only input](../../adr/0003-applications-are-the-solvers-only-input.md)).
The CSV export is built from the assignment itself, not from an upload kept for the purpose.
Only `migrate_to_uuid.py`, `mongo-init.js` and `reset_database.py` still name the old collection.

**`assign_market` reads the market's own approved applications.**
Only `reviewer_approved` main applications feed it, and not a vendor added by hand, who is seated by hand ([adding a vendor who never applied](../../business/rules/adding-a-vendor-who-never-applied.md)).
Hand-placed rows on the stored assignment are seated first, and applicants outside the run who hold one are seated as held ([placements](placements.md#pins)).

**`vendor_input.py` is the one seam where application shape meets solver shape**, and the only place that knows both.
It lives in the solver package because the solver owns what it needs from an application, while [`api/applications.py`](../../../back-end/api/applications.py) owns storage and carries no solver knowledge ([the application document](../data/application-document.md)).
It is unit-testable with no database and no `MarketAssignment` (`tests/test_solver_vendor_input.py`).
A typed record has a failure signal the old attribute bag lacked: a wrong name raises rather than reading as "the vendor answered nothing".
An answer naming something the offering no longer holds (a dropped tier, a removed date) is dropped, so the vendor may be unplaceable and reported unassigned; an answer that is absent refuses the run.
Which questions count as asked is `asked_essential_keys()` in [essential fields](essential-fields.md), never restated here.

**Placement is vendor-driven.**
`assign()` walks the dates in the plan's stored order ([dates fill one at a time, in the plan's order](../../business/rules/dates-fill-in-calendar-order.md)); on each date it sorts the vendors ([priority and tie-breaks](../../business/rules/priority-and-tie-breaks.md)) and gives each, in turn, the best table still open to them (`best_table_for`).
It was table-driven: each table asked which vendor it should take, which made a vendor's own section ranking unable to influence anything, and stopped a date at the first table nobody could fill ([tier filters, section prefers](../../business/rules/tier-filters-section-prefers.md)).
Who fills the other half of a table is `get_valid_vendors`: a whole-table vendor takes both halves, a table-share partner takes the other ([table-share pairing](../../business/rules/table-share-pairing.md)), an Either chooser takes a whole table once the section's half-table share is reached ([the half-table share](../../business/rules/half-table-share.md)), and otherwise the next vendor who accepts a half.
A vendor stops being offered dates at the lower of the market's ceiling and their own answer ([the ceiling on dates per vendor](../../business/rules/max-assignments-ceiling.md)).

**A placement is dated by the market date itself**, the string on `MarketDateObject.date`, and the solver keys its per-date state by that same string.
It used to be dated by the spreadsheet column heading, which is why check-in, the table rows and the statistics each built a map from headings back to dates; those maps are gone, and none is to be reintroduced.
`SolverVendor.available_dates` holds the plan's own spelling of each date for the same reason: parsing it would make a second representation of one identity.

**A section may have no tier and no location**, because the plan editor accepts both; an untiered table takes anyone, and its placement records no tier (bug 23).

**Table type is stubbed to one type**, so the table-type ranking is never asked and the solver never reads one (`STUB_TABLE_TYPE` in [essential fields](essential-fields.md)).

**A field added to `SolverVendor` changes every assignment fingerprint**, and every stored assignment then reads as out of date, unless `made_from._ADDED_SINCE_FINGERPRINTS` names it with the value that means "nothing" ([made from](made-from.md)).

**Change placement against the behavioural suite, not beside it** ([the assignment behaviour suite](../testing/assignment-behaviour-suite.md)).

## Why

- [Applications are the solver's only input](../../adr/0003-applications-are-the-solvers-only-input.md), and [essential fields are exactly what the solver reads](../../adr/0001-essential-fields-are-the-solver-contract.md).
- [Priority and tie-breaks](../../business/rules/priority-and-tie-breaks.md), whose rule shape is [a priority rule names a target](../../adr/0004-a-priority-rule-names-a-target.md).
- [Tier filters, section prefers](../../business/rules/tier-filters-section-prefers.md).
- [Table-share pairing](../../business/rules/table-share-pairing.md) and [the half-table share](../../business/rules/half-table-share.md).
- [The ceiling on dates per vendor](../../business/rules/max-assignments-ceiling.md).
- [An incomplete application refuses the run](../../business/rules/an-incomplete-application-refuses-the-run.md), and [what an import may leave unasked](../../business/rules/what-an-import-may-leave-unasked.md).
- [Dates fill one at a time, in the plan's order](../../business/rules/dates-fill-in-calendar-order.md).

The organizer sets the rules and runs it in [the assignment and its result](../../business/flows/assignment-and-result.md).

The glossary concepts it serves: [Assignment](../../business/concepts/assignment.md) and [Table sharing](../../business/concepts/table-sharing.md).
