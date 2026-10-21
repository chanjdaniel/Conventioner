---
layer: business
kind: rule
describes:
  - back-end/api/added_vendors.py
  - back-end/api/markets.py#adding_refusal
  - back-end/api/markets.py#add_vendor_refusal
  - back-end/assignment/vendor_input.py#approved_solver_vendors
verified: 2026-10-22
sources:
  - wayfinding/rejection-visibility/02
  - E36/F03/S01
---

# Adding a vendor who never applied

From the assignment on, an organizer may add a vendor who never applied, by name and address; the vendor is stored as an approved application stamped with who added them and when, is never placed by the run, and is seated by hand.
An address the market already holds an application for is refused: that vendor is seated on the Result page instead.

## Why

A walk-in or a late arrangement was once seated by typing an address into a seat: no name, no answers, nothing in the vendor drawer.
A seat now goes only to an applicant ([a seat only for an applicant](a-seat-only-for-an-applicant.md)), and adding is how someone becomes one without applying ([ADR 0013](../../adr/0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md)).

**Added by hand, so never in the run.**
Their answers may be missing, and an approved application missing a required answer refuses the run for everyone; so the run skips them, and they are held in their seat like any pin.
They are approved by the act of adding, and the organizer who added them is recorded as giving that verdict.

## Who may

An EDITOR, in `assignment` and `market_days` only; an archived market refuses anyone.
The market read serves `addVendorReason` (the person's role and the phase in one reason), so the Vendors page offers the action exactly when the write would take it.

## Where it is kept

- `POST /markets/:id/vendors` is `add_vendor` in [`back-end/api/added_vendors.py`](../../../back-end/api/added_vendors.py): a missing name or address is a 400; the wrong phase or a held address is a 409.
- The phases are `adding_refusal` and the served reason `add_vendor_refusal` in [`back-end/api/markets.py`](../../../back-end/api/markets.py).
- The run skips any application with `added_by` in `approved_solver_vendors` ([`back-end/assignment/vendor_input.py`](../../../back-end/assignment/vendor_input.py), [the assignment solver](../../implementation/modules/assignment-solver.md)).
- The stored application, its full name as the only answer and the `added_by`/`added_at` stamp are [the application document](../../implementation/data/application-document.md); the held seat is [placements](../../implementation/modules/placements.md).
