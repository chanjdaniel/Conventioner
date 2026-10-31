---
layer: business
kind: rule
describes:
  - back-end/api/added_vendors.py
  - back-end/api/markets.py#adding_refusal
  - back-end/api/markets.py#needs_a_table
  - back-end/api/markets.py#count_added_vendors
  - back-end/assignment/vendor_input.py#approved_solver_vendors
  - front-end/src/components/AddVendorDialog.vue
verified: 2026-10-31
sources:
  - wayfinding/rejection-visibility/02
  - E36/F03/S01
  - E38/F08/S02
  - E43/F01/S03
---

# Adding a vendor who never applied

From Assignment on, an organizer may add a vendor who never applied, by name and address and the answers the market's prices are set by; the vendor is stored as an approved application stamped with who added them and when, is never assigned when tables are allocated, and is assigned by hand.
An address the market already holds an application for is refused: that vendor is assigned on the Assignments page instead.

**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md) and [The door on market day](../intents/the-door-on-market-day.md).

## Why

A walk-in or a late arrangement was once seated by typing an address into a seat: no name, no answers, nothing in the vendor drawer.
A seat now goes only to an applicant ([a seat only for an applicant](a-seat-only-for-an-applicant.md)), and adding is how someone becomes one without applying ([ADR 0013](../../adr/0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md)).

**Added by hand, so never in the run.**
Their answers may be missing, and an approved application missing a required answer refuses the run for everyone; so the run skips them, and they are held in their seat like any pin.
They are approved by the act of adding, and the organizer who added them is recorded as giving that verdict.

**Asked what their price is set by.**
A vendor added by hand is asked every question of the market's own form that a [price group](a-price-follows-the-table.md) reads, each required though the form may leave it optional (Daniel, T92 Q14: "when adding a vendor by hand the organizer must fill out this required info"), so they are priced like any other vendor rather than landing in "Everyone else" for want of an answer.
A checkbox left unticked is its "not ticked" answer, so it is never missing.
No question is named by the code: whichever of its own questions a market's groups read are asked, and a market whose card has no group, or only groups whose conditions the form no longer has, asks nothing more.
An essential choice a group may read, the table choice or the dates, is not asked: it is the assignment's, and an added vendor's table and days are the ones they are seated at by hand.

**Out of the run, but needing a table like anyone.**
"In the run" says only who the run places; a vendor added by hand needs a table on every market day, so one without a table is unassigned: listed under the Vendors page's "Unassigned only" (and on each date they hold none, with a date chosen), "Unassigned" beside "Added" on their row, and counted in the Assignments page's "N unassigned" and "N of M approved applicants assigned", so the link and the list agree (bug 10).
The server says it of each vendor apart from "in the run" (`needs_a_table` and `count_added_vendors` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)); seated on any day, they count as assigned, as the run's vendors do.

## Who may

An EDITOR, in `assignment` and `market_days` only; an archived market refuses anyone.
The market read serves the table's Add a vendor who never applied answer and the phase's rule apart (`actionRefusals` and `addingVendorsReason`), and the Vendors page offers the action only when neither refuses, exactly when the write would take it.

## Where it is kept

- `POST /markets/:id/vendors` is `add_vendor` in [`back-end/api/added_vendors.py`](../../../back-end/api/added_vendors.py): a missing name or address, a missing price answer, one the form would refuse, or an answer to a question adding does not ask is a 400; the wrong phase or a held address is a 409, each a [client error](../../implementation/conventions/an-exception-never-reaches-a-client.md) saying why.
- The questions asked are `Groups.fields` in [`back-end/pricing.py`](../../../back-end/pricing.py), the form's own of those the market read serves as `priceReads`; the dialog, [`AddVendorDialog.vue`](../../../front-end/src/components/AddVendorDialog.vue), asks them in the form's order with the form's own controls and offers "Add vendor" only once each is answered.
- The phases are `adding_refusal` in [`back-end/api/markets.py`](../../../back-end/api/markets.py), served as `addingVendorsReason`.
- The run skips any application with `added_by` in `approved_solver_vendors` ([`back-end/assignment/vendor_input.py`](../../../back-end/assignment/vendor_input.py), [the assignment solver](../../implementation/modules/assignment-solver.md)).
- The stored application, its full name and its price answers as its only answers, and the `added_by`/`added_at` stamp are [the application document](../../implementation/data/application-document.md); the held seat is [placements](../../implementation/modules/placements.md).
- Each vendor added is recorded in [the market's history](../../implementation/data/history.md) (`add-vendor`), with the name, status and the price answers given (nested under `answers`, so no question key collides with the name or status) and who added them; the History reads each answer under its question.
- `back-end/tests/test_adding_a_vendor.py`, `back-end/tests/test_the_price_answers.py`, `front-end/src/__tests__/addingAVendorAsksThePriceAnswers.test.ts`, `front-end/e2e/adding-a-vendor.spec.ts` and `front-end/e2e/the-price-answers.spec.ts` pin it.
