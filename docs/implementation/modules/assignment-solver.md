---
layer: implementation
kind: module
describes:
  - back-end/assignment/assignment.py
  - back-end/assignment/vendor_input.py
  - back-end/assignment/csv_output.py
  - back-end/assignment/invariants.py
verified: 2026-11-09
sources:
  - wayfinding/v0-1-0/map
  - wayfinding/v0-1-0/02
  - E02
  - E02/F01/S02
  - E02/F04
  - E01/F05
  - E27
  - bug/23
  - T65
  - T77
  - E41/F01/S02
  - T139
  - T253
  - T263
---

# The assignment solver

The solver decides who sits at which table on which date, from the market's plan and its approved applications.
[`back-end/assignment/assignment.py`](../../../back-end/assignment/assignment.py) runs it; [`back-end/assignment/vendor_input.py`](../../../back-end/assignment/vendor_input.py) is what it reads; [`back-end/assignment/csv_output.py`](../../../back-end/assignment/csv_output.py) turns a stored assignment into the CSV an organizer downloads.
Storing a run, and every hand edit to one, is [placements](placements.md); what a run was made from is [made from](made-from.md).

## Its interface

- `assign_market(market, vendors=None, held=None)`: runs the solver over the market's own approved applications and returns the market with its `assignmentObject` filled; it stores nothing.
  It refuses an allocation that breaks one of the solver's rules: it raises `BrokenAllocationError` before it replaces the market's assignment ([every table allocation is checked](#sharp-edges), below).
  A caller may pass the vendors in (the behavioural suite does, to describe a scenario with no database), but no caller has to fetch anything first.
- `solver_vendors_for(market)`: the vendors the approved applications describe, or `IncompleteApplicationsError` naming every applicant whose answers are missing ([an incomplete application refuses the run](../../business/rules/an-incomplete-application-refuses-the-run.md)).
- `vendors_to_show(market)`: the same vendors for a read of the stored assignment, each approved application read as it stands, so a missing answer refuses nothing (`approved_solver_vendors(..., lenient=True)`).
- `describe_stored_assignment(market, vendors=None)`: seats the stored rows and derives statistics without running `assign()`, over `vendors_to_show` when no vendors are passed; every read-only view goes through it ([placements](placements.md#what-a-read-shows)).
- `SolverVendor` (`vendor_input.py`): one vendor as the solver sees them, a frozen dataclass of what they asked for; `Vendor` (`assignment.py`) wraps it with one run's working state.
- `allocation_breaches(setup, vendors, pins, orphaned_pins, assignments)` ([`invariants.py`](../../../back-end/assignment/invariants.py)): every way an allocation breaks one of the solver's rules, as `Breach`es (the rule, the date, the table code and the application ids), ordered by rule, date, table and ids; empty when it is sound.
  It is pure: it reads the plan, the vendors and the rows it is given, and imports no database, no Flask and nothing from `api/`.
- `require_sound_allocation(...)`, with the same arguments: raises `BrokenAllocationError` (a `RuntimeError`) holding the breaches when there are any.

## Sharp edges

**There is no spreadsheet behind a market.**
E02 removed `source_data`, its endpoints and its collection, every `col_name`/`col_name_idx`/`col_names`/`col_values`/`col_include`, and `enum_priority_order` ([applications are the solver's only input](../../adr/0003-applications-are-the-solvers-only-input.md)).
The CSV export is built from the assignment itself, not from an upload kept for the purpose.
Only `migrate_to_uuid.py`, `mongo-init.js` and `reset_database.py` still name the old collection.

**The export writes the applicant's own text as text.**
The Name, Full name and Email cells go through `as_text_cell`, which prefixes a single quote to a value beginning with `=`, `+`, `-`, `@`, tab, CR or LF, so a name such as `=1+1` is shown, not run, when the organizer opens the file (OWASP, CSV injection).
Every other value is written exactly as it is; the date cells are the organizer's plan and are not guarded (`tests/test_csv_formula_guard.py`).

**`assign_market` reads the market's own approved applications.**
Only `reviewer_approved` main applications feed it: a waitlist application stands beside a person's main one, so reading both would place one person twice, and nothing creates one yet.
A vendor added by hand does not feed it either: they are seated by hand ([adding a vendor who never applied](../../business/rules/adding-a-vendor-who-never-applied.md)).
Hand-placed rows on the stored assignment are seated first, and applicants outside the run who hold one are seated as held ([placements](placements.md#pins)).

**`vendor_input.py` is the one seam where application shape meets solver shape**, and the only place that knows both.
It lives in the solver package because the solver owns what it needs from an application, while [`api/applications.py`](../../../back-end/api/applications.py) owns storage and carries no solver knowledge ([the application document](../data/application-document.md)).
It is unit-testable with no database and no `MarketAssignment` (`tests/test_solver_vendor_input.py`).
It reads an application's answers through `effective_answers`, so an answer an organizer updated is the one the vendor is placed by, and the run after an update uses it ([an update is kept beside the vendor's answer](../../business/rules/an-update-is-kept-beside-the-vendors-answer.md)).
A typed record has a failure signal the old attribute bag lacked: a wrong name raises rather than reading as "the vendor answered nothing".
An answer naming something the offering no longer holds (a dropped tier, a removed date) is dropped, so the vendor may be unplaceable and reported unassigned; an answer that is absent refuses the run.
Which questions count as asked is `asked_essential_keys()` in [essential fields](essential-fields.md), never restated here.

**Placement is vendor-driven.**
`assign()` walks the dates in the plan's stored order ([dates fill one at a time, in the plan's order](../../business/rules/dates-fill-in-calendar-order.md)); on each date it sorts the vendors ([priority and tie-breaks](../../business/rules/priority-and-tie-breaks.md)) and gives each, in turn, the best table still open to them (`best_table_for`).
It was table-driven: each table asked which vendor it should take, which made a vendor's own section ranking unable to influence anything, and stopped a date at the first table nobody could fill ([tier filters, section prefers](../../business/rules/tier-filters-section-prefers.md)).
Who fills the other half of a table is `get_valid_vendors`: a whole-table vendor takes both halves, a table-share partner takes the other ([table-share pairing](../../business/rules/table-share-pairing.md)), an Either chooser takes a whole table once the section's half-table share is reached ([the half-table share](../../business/rules/half-table-share.md)), and otherwise the next vendor who accepts a half.
A vendor nobody may share with holds the whole table, both seats, as a Full chooser does, so nobody is put on its other half (`assign_table`).
A vendor stops being offered dates at the lower of the market's ceiling and their answer as the organizer reads it ([the ceiling on dates per vendor](../../business/rules/max-assignments-ceiling.md)).

**Every table allocation is checked before it is returned.**
`assign_market` calls `require_sound_allocation` with the run's plan, vendors, the pins it started from and the pins it orphaned, so an allocation that breaks a rule is never stored, never shown and never published (T253).
A solver row is one the run made; a pin is a row with `hand_placed` true.
The rules, in the order the breaches are reported:

1. "a pin was not kept": every pin the run started from is among the rows, unchanged.
2. "a hand-placed row nobody placed": every row marked hand-placed is one of those pins.
3. "an assignment for someone outside the run": every solver row is for a run vendor; a held vendor holds pins only, and such a row is judged no further.
4. "a date the market does not run": every solver row's date is one of the plan's.
5. "a table the plan does not have": every solver row's table code is one the plan's sections make.
6. "an assignment that misdescribes its table": a solver row's section, tier and location are the plan's for its table, `""` where the section has none.
7. "a seat the table does not have": a solver row is assigned as "Full Table", "Half Table (Left)" or "Half Table (Right)".
8. "a day they cannot come": a solver row's date is one the vendor can attend.
9. "a tier they did not choose that day": the vendor accepts the table's tier on that date.
10. "a half for a vendor who asked for a whole table": a Full chooser's solver rows are all "Full Table".
11. "two assignments for one vendor on one day": no vendor holds two rows on one date where one is a solver row.
12. "more days than their limit": a vendor with a solver row holds no more of the plan's dates, pins and orphaned pins counted as the solver counts them, than the lower of the market's ceiling and their answer as the organizer reads it.
13. "a seat taken twice": "Full Table" holds both seats and a half one, and no seat is held twice where one holder is a solver row, an orphaned pin holding no seat.

It does not judge the organizer's own decisions: pins among themselves, or a pin against its vendor's answers, since the placement write refuses a pin on a taken seat and [a pin that overrides an answer stands, and is marked](placements.md#pins).
One contradiction among pins still refuses the run: two pins for one vendor on one date, since the solver keeps one row per vendor per date and drops the other pin, which the check reports as "a pin was not kept"; no placement write makes such a pair, since a second placement on a date moves the vendor.
An orphaned pin holds no seat, so the solver may give that seat to someone else, as it always has.
Nor does it judge the soft rules (pairs together, the half-table share, the priority order, section ranking), which the greedy solver keeps where it can; the behaviour suite's cases pin them.
A breaking allocation is a solver defect, so the error is a builtin that escapes as the generic 500 ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md#the-types)); its message names each breach by rule, table, date and application ids, the first 10 then "and N more", and never an address, a row for someone outside the run reading "outside the run".
Every test that runs the real solver is held to the same check, since it runs inside `assign_market`, and [`tests/test_assignment_invariants.py`](../../../back-end/tests/test_assignment_invariants.py) tests each rule on hand-built rows.
Its seeded random markets hold the solver to the same check over 1,000 generated markets, each run again around hand-placed assignments, some of them held by an applicant outside the run or past what the plan can hold ([the assignment behaviour suite](../testing/assignment-behaviour-suite.md#beside-it)).

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
- [What a correct assignment is](../../business/rules/what-a-correct-assignment-is.md): a run breaking its second criterion, or seating two vendors at one seat, is refused by the check.

The organizer sets the rules and runs it in [the assignment and its result](../../business/flows/assignment-and-result.md).

The glossary concepts it serves: [Assignment](../../business/concepts/assignment.md) and [Table sharing](../../business/concepts/table-sharing.md).
