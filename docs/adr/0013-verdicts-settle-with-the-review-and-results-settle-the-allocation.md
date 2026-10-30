---
layer: implementation
kind: adr
describes:
  - back-end/api/markets.py#review_is_open
  - back-end/api/placements.py#assign_refusal
  - back-end/result_outcome.py#outcome_of
verified: 2026-10-29
sources:
  - wayfinding/rejection-visibility/01
  - wayfinding/rejection-visibility/02
  - wayfinding/rejection-visibility/map
  - E36
status: accepted
---

# Verdicts settle with the review, and results settle the allocation

The glossary concepts: [Application](../business/concepts/application.md) and [Assignment](../business/concepts/assignment.md).

## Context

A verdict, a seat and what an applicant is told are three records of one vendor, and before E36 nothing held them together.
Verdicts stayed open after a run, so a vendor rejected after the assignment kept their seat; a hand placement took any address; a pin for someone not approved was kept as an orphan that blocked nothing; going live needed only a stored run.
A rejected vendor could therefore stay seated, go live and check in.
On the applicant's side, an undecided application read "Submitted" and every decided one "Under Review", and the automatic rules judge an application in the request that saves it, so the label told an applicant a rule had rejected them the moment they submitted.
Results could be published with nothing reviewed and nothing assigned.

Daniel's position going in: a verdict is locked once the market has moved on and the assignment is done; results are not publishable until everything is reviewed and allocated; additions after that are made by hand.

## Decision

**A verdict settles with the review.**
Verdicts, follow-ups included, are open while the market can still get back to `applications`, the stage where they are given ([ADR 0016](0016-one-stage-for-applications-and-review.md)), and closed from `assignment` on, with no way back ([verdicts settle on entering assignment](../business/rules/verdicts-settle-on-entering-assignment.md)); entering `assignment` already needs every application approved or rejected.
From there a verdict is the review's record and stays as it is.
A mistake is fixed with seats: an applicant the review rejected is placed by hand, warned and held as a pin, or an approved vendor's seat is freed ([a seat only for an applicant](../business/rules/a-seat-only-for-an-applicant.md)); someone who never applied is added first ([adding a vendor who never applied](../business/rules/adding-a-vendor-who-never-applied.md)).
The automatic rejections settle on the same rule (`review_is_open` in [`back-end/api/markets.py`](../../back-end/api/markets.py)), since a rule and a reviewer judge the same applications.

**Results settle the allocation.**
On a market whose vendors apply on its own page, Publish Results is its own act, offered in `assignment` once a run is stored and up to date, behind a confirmation that counts who will read each outcome ([Publish Results waits for the allocation](../business/rules/publish-results-waits-for-the-allocation.md)).
Publishing ends re-runs (`assign_refusal` in [`back-end/api/placements.py`](../../back-end/api/placements.py)) and locks the assignment rules; seats change only by hand after it, and the market cannot go live before it.
A market that imports its vendors has nobody to tell, and neither publishes nor waits.

**What an applicant reads is the seat, not the verdict.**
"Submitted" before results are published, whatever happened, a rule's rejection included; after, "You have a table", with each date's table, or "You did not get assigned", with no reason ever ([an applicant never reads a verdict early](../business/rules/an-applicant-never-reads-a-verdict-early.md)).
It is worked out from the stored seats on every read (`outcome_of` in [`back-end/result_outcome.py`](../../back-end/result_outcome.py)), so rejected, approved without a seat and, once offers exist, declined all read the same.

## Consequences

- The review's record and the seats may disagree, on purpose and visibly: a rejected applicant seated by hand is marked "not approved" wherever overrides show, and is never counted among the run's vendors ([placements](../implementation/modules/placements.md)).
- Nobody can correct a verdict after the market enters `assignment`, even to make the record match a seat; the record says what the review decided.
- A hand change after publishing shows on the applicant's page at once, because nothing about the outcome is stored.
- There is no unpublish: once applicants have read an outcome, nothing un-tells them, and re-running would move seats under people already told.
- `vendor_refused` is unreachable today and reads "You did not get assigned" until an offers flow exists; no outcome email is sent.

## Considered and rejected

- **Verdicts open after the run**, the state before: the seats and the record drifted apart silently, and a rejected vendor could check in.
- **A way back from `assignment` to the review**: it would reopen every verdict to fix one, and the run made from them would stop describing the review.
- **A third outcome, "Not accepted", and "You declined" for a vendor who turned an offer down**: answered first in the same grilling and replaced the same day, because nothing can produce a decline today, so there are just two outcomes.
- **Publishing results whenever the organizer chooses**, as before: results say whether an applicant has a table, so they can be told only once the seats exist, and once told, a later run must not shift the answer under them.
