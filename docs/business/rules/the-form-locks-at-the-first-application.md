---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#application_form_lock_reason
  - back-end/api/markets.py#prepared_application_form
  - back-end/api/markets.py#save_application_form
  - back-end/api/markets.py#ApplicationFormLockedError
  - back-end/guards.py#NoApplicationsYetGuard
  - front-end/e2e/helpers/seedApplication.ts
verified: 2026-10-22
sources:
  - wayfinding/real-market-readiness/05
  - E03/F04
  - E20/F03
  - E21/F02/S03
  - E21/F03/S06
  - E31/F03/S02
---

# The form locks at the first application

A market's application form may be edited only while the market is a draft and nobody has applied to it; once one application exists, by an applicant or by import, the form is fixed for good (the decision called D9).

## Why

An applicant answers the form as it stands; a question that moved after they answered would leave their answer meaning something they never said, or a required answer they were never asked.
The form is editable in `draft` alone, and the way back to draft (`applications_open -> draft`) is open only while no application exists (`NoApplicationsYetGuard`).
That guard is not redundant with the lock: the lock runs when the form is written, the guard when the market moves, and applicant submission is gated to `applications_open`, so a count of zero is stable in `draft` and a race while applications are open; gating the going back is what makes the lock race-free.
A form found wrong after leaving draft, while nobody has applied, is fixed through [the form amendment](../../implementation/modules/form-amendment.md), which walks the market back to draft and forward again; after the first application nothing changes it.
Writing a question in place from the import, while applications are open, was rejected: it carries the same race, and it would be a second writer of the form.

## Where it is kept

- **`application_form_lock_reason()`** in [`back-end/api/markets.py`](../../../back-end/api/markets.py) is the one source of truth: the archived reason on an archived market, the path's own words outside `draft` (a CSV market's form is "the questions" its imports are mapped onto), and the count of applications in `draft`.
  It rides on the market read as `applicationFormLockReason`, so the form builder reads the lock from the market it holds.
- **`Market.application_form` is written through one judgement, `prepared_application_form`**: the lock, then the validator ([the market document](../../implementation/data/market-document.md#the-fields-that-matter)).
  `PUT /markets/:id/application-form` (`save_application_form`) writes it alone, answering a lock with a 409 (`ApplicationFormLockedError`), and [the CSV start](../../implementation/modules/csv-proposal-and-start.md)'s confirm writes it in one update with the plan and the mapping.
  That shared judgement is what makes the lock unbypassable; do not add a writer that skips it (the whole-market PUT that did is deleted, E21/F03/S06).
  `POST /markets` may carry a form, which runs through the same validator; `prepared_plan` is the plan write's equivalent.
- **The count is of the market's applications by `market_id`**, through `back-end/api/applications.py`, their single owner; a writer storing the market reference under any other key would make the count 0 and silently disable the lock ([the application document](../../implementation/data/application-document.md#key-spelling)).
- `NoApplicationsYetGuard` in [`back-end/guards.py`](../../../back-end/guards.py), kept by [the guards](../../implementation/modules/guards.md).
- **E2E reaches the locked state with `seedApplication()`** ([`front-end/e2e/helpers/seedApplication.ts`](../../../front-end/e2e/helpers/seedApplication.ts)), which writes the application document straight into Mongo through `mongoEval`, snake_case as `api/applications.py` stores it.
  It is the one way a spec puts an application on a market without signing in as an applicant, and works in any phase ([the E2E seeds](../../implementation/testing/e2e-seeds.md)).
- `back-end/tests/test_the_lock_rides_on_the_market.py` pins the reasons, and `front-end/e2e/application-form.spec.ts` the builder under the lock.

## Superseded

The way back to draft was first paired with a dead end in the import: a column the organizer wanted to keep said it had nowhere to go and told them to return the market to draft themselves, the price accepted for one writer and no race (wayfinding/real-market-readiness/05).
The form amendment now takes that walk for them from inside the import, still writing the form only in draft and only through its one judgement (E20/F03).
