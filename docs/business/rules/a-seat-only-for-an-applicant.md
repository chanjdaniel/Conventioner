---
layer: business
kind: rule
describes:
  - back-end/api/placements.py#has_applied
  - back-end/api/placements.py#_applicant_address
  - front-end/src/utils/placementChange.ts#groupCandidates
  - front-end/src/utils/placementChange.ts#notApprovedWarning
verified: 2026-10-22
sources:
  - wayfinding/rejection-visibility/02
  - E36/F02/S01
  - E36/F02/S02
  - E36/F02/S03
---

# A seat only for an applicant

A seat goes only to someone with an application in the market: a placement or a swap naming anyone else is refused, with "Add them as a vendor first".
Within that, anyone may be pinned: an applicant the review did not approve is offered too, under a warning, and held in that seat.

## Why

A typed address used to take a seat with no name, no answers and nothing in the vendor drawer.
An application is what gives a seated vendor all three, so a vendor who never applied is [added by hand](adding-a-vendor-who-never-applied.md) first, and then has them.

The review governs the run, not the organizer's hand.
An applicant the review left out is one deliberate, warned pick away, because an override is a decision the organizer is allowed to make.
It is also how a verdict found wrong after the review settled is answered: with a seat, never by changing the verdict ([ADR 0013](../../adr/0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md)).

## What the organizer sees

The place dialog offers every applicant, grouped and never filtered: "Fits this seat", "Would override their answers", "Not approved" and "Added by hand".
Choosing a not-approved applicant warns in the review's own words, "Not approved: Rejected by ..., Oct 19.".
A seat given to one is marked "not approved" wherever the other overrides show: on the seat, in the vendor drawer, and in the download's Approval column.

## What the run does with them

A not-approved applicant pinned to a seat is seated as **held**: the seat is occupied, they are placed nowhere else, and they are never counted among the run's vendors.

## Who may

An EDITOR, the bar every placement write sets.

## Where it is kept

- `has_applied` and `_applicant_address` in [`back-end/api/placements.py`](../../../back-end/api/placements.py): every placement writes the applicant's normalised address, or refuses one the market has no application for; a swap refuses either side the same way.
- A seed that places someone gives them an application first.
- The held seat and the run are [placements](../../implementation/modules/placements.md); what an application stores is [the application document](../../implementation/data/application-document.md).
- The dialog's groups and warning are `groupCandidates` and `notApprovedWarning` in [`front-end/src/utils/placementChange.ts`](../../../front-end/src/utils/placementChange.ts), from the candidates `GET /markets/:id/tables` serves with each one's status.
