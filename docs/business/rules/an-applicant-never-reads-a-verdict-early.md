---
layer: business
kind: rule
describes:
  - back-end/api/applicants.py#applicant_visible_status
  - back-end/api/applicants.py#_application_response
  - back-end/result_outcome.py#outcome_of
  - back-end/result_outcome.py#seats_of
  - front-end/src/utils/applicantOutcome.ts
verified: 2026-10-22
sources:
  - wayfinding/rejection-visibility/01
  - wayfinding/rejection-visibility/02
  - wayfinding/rejection-visibility/map
  - E36/F05
  - E36/F05/S01
  - E36/F05/S02
  - E26/F07/S02
  - bug/20
---

# An applicant never reads a verdict early

An applicant's own page reads "Submitted" until the organizer publishes results, whatever review has decided; after that it reads "You have a table", with their seats, or "You did not get assigned", and never a verdict or a reason.
Applying, and changing one's answers, is open only while the market is in `applications_open`; reading one's application is open in every phase but draft.

## Why

An organizer must not leak a half-finished review, and must keep the freedom to change their mind until anyone is told.
The automatic rules judge an application in the request that saves it, so a status beside "Submitted" told an applicant a rule had rejected them the moment they submitted, and editing their answers flipped it back (E36/F05/S01).
Publication is the single, deliberate moment anything more is told ([Publish Results waits for the allocation](publish-results-waits-for-the-allocation.md)); why the seat and not the verdict is what an applicant reads is [ADR 0013](../../adr/0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md).

**The outcome is read off the stored seats, never the verdict** (E36/F05/S02).
A rejected applicant seated by hand has a table, and an approved one the run could not place has none; so rejected and approved-without-a-seat read the same, and no reason is given to either.
It is read on every request, so a seat changed by hand shows at once.

**Reading stays open after applying closes** (E26/F07/S02): closing the applicant surface with applications hid every verdict before most organizers published one (bug 20).
A stranger applying to a closed market stays wrong, so the save refuses outside `applications_open` in words naming the phase.

## Where it is kept

- **`applicant_visible_status`** in [`back-end/api/applicants.py`](../../../back-end/api/applicants.py) serves only `open`, whatever is stored.
  It is enforced on the way out of the server, because anything the applicant's browser receives the applicant can read: a label mapped over a payload carrying `reviewer_rejected` still ships the rejection in the response.
  Every applicant-facing payload passes through `_application_response`; the organizer's view never does, and shows the stored status ([the application document](../../implementation/data/application-document.md#statuses)).
- **The outcome** is `outcome_of` and the seats `seats_of` in [`back-end/result_outcome.py`](../../../back-end/result_outcome.py), the same reading the publish confirmation counts by; both are in the response only once `resultsPublished` is set.
- The words are [`front-end/src/utils/applicantOutcome.ts`](../../../front-end/src/utils/applicantOutcome.ts), which only words what the server decided.
- The save's phase refusal is `save_applicant_application`, behind [the gate](a-gated-market-answers-as-absent.md) that serves a form market in every phase but draft.
- `back-end/tests/test_applicant_publication_gate.py`, `front-end/e2e/vendors-see-their-application-after-close.spec.ts` and `front-end/e2e/results-wait-for-the-allocation.spec.ts` pin it.

## Superseded

- Three outcomes after publishing, "Not accepted" beside a table and none, with "You declined" for a vendor who turned an offer down, answered first and replaced the same day: nothing can produce a decline today, so there are two (wayfinding/rejection-visibility/02).
