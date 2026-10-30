---
layer: business
kind: rule
describes:
  - back-end/api/added_vendors.py
  - back-end/api/markets.py#adding_refusal
  - back-end/api/markets.py#needs_a_table
  - back-end/api/markets.py#count_added_vendors
  - back-end/assignment/vendor_input.py#approved_solver_vendors
verified: 2026-10-30
sources:
  - wayfinding/rejection-visibility/02
  - E36/F03/S01
  - E38/F08/S02
---

# Adding a vendor who never applied

From Assignment on, an organizer may add a vendor who never applied, by name and address; the vendor is stored as an approved application stamped with who added them and when, is never assigned when tables are allocated, and is assigned by hand.
An address the market already holds an application for is refused: that vendor is assigned on the Assignments page instead.

**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md) and [The door on market day](../intents/the-door-on-market-day.md).

## Why

A walk-in or a late arrangement was once seated by typing an address into a seat: no name, no answers, nothing in the vendor drawer.
A seat now goes only to an applicant ([a seat only for an applicant](a-seat-only-for-an-applicant.md)), and adding is how someone becomes one without applying ([ADR 0013](../../adr/0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md)).

**Added by hand, so never in the run.**
Their answers may be missing, and an approved application missing a required answer refuses the run for everyone; so the run skips them, and they are held in their seat like any pin.
They are approved by the act of adding, and the organizer who added them is recorded as giving that verdict.

**Out of the run, but needing a table like anyone.**
"In the run" says only who the run places; a vendor added by hand needs a table on every market day, so one without a table is unassigned: listed under the Vendors page's "Unassigned only" (and on each date they hold none, with a date chosen), "Unassigned" beside "Added" on their row, and counted in the Assignments page's "N unassigned" and "N of M approved applicants assigned", so the link and the list agree (bug 10).
The server says it of each vendor apart from "in the run" (`needs_a_table` and `count_added_vendors` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)); seated on any day at a seat the plan still holds, they count as assigned, while a placement the plan no longer holds leaves them unassigned, matching the Vendors page, which draws seats from the plan (an orphaned pin, [placements](../../implementation/modules/placements.md#pins)).
The solver, unlike this count, still counts a run vendor's orphaned pin as the date it claimed.

## Who may

An EDITOR, in `assignment` and `market_days` only; an archived market refuses anyone.
The market read serves the table's Add a vendor who never applied answer and the phase's rule apart (`actionRefusals` and `addingVendorsReason`), and the Vendors page offers the action only when neither refuses, exactly when the write would take it.

## Where it is kept

- `POST /markets/:id/vendors` is `add_vendor` in [`back-end/api/added_vendors.py`](../../../back-end/api/added_vendors.py): a missing name or address is a 400; the wrong phase or a held address is a 409, each a [client error](../../implementation/conventions/an-exception-never-reaches-a-client.md) saying why.
- The phases are `adding_refusal` in [`back-end/api/markets.py`](../../../back-end/api/markets.py), served as `addingVendorsReason`.
- The run skips any application with `added_by` in `approved_solver_vendors` ([`back-end/assignment/vendor_input.py`](../../../back-end/assignment/vendor_input.py), [the assignment solver](../../implementation/modules/assignment-solver.md)).
- The stored application, its full name as the only answer and the `added_by`/`added_at` stamp are [the application document](../../implementation/data/application-document.md); the held seat is [placements](../../implementation/modules/placements.md).
- Each vendor added is recorded in [the market's history](../../implementation/data/history.md) (`add-vendor`), with the name and status given and who added them.
