---
id: E19/F02/S01
title: A vendor's preferred name
type: story
status: ready
blocked_by: [E19/F01/S02]
pr: []
---

## What to build

An applicant can give the name they want to be called.
A CSV import can map the preferred-name column the real export already carries.
Every vendor-facing screen shows that name, falling back to the legal name when there is none.

## The shape it takes, which the contract already has a precedent for

**Essential but not required.**
It is asked of every applicant and an applicant may leave it blank - exactly the shape the table-share partner answer already has, which is in the essential set and deliberately absent from the required one.

**Asked unconditionally.**
Every other essential question is gated on the plan offering something; the applicant's name is not, because identity does not depend on the plan.
Preferred name follows the legal name here.

**Outside the solver-relevant set**, so correcting a spelling never invalidates a completed review.

**Not declarable-unasked.**
That list admits rankings only, and the reasoning is that a default on a non-ranking invents a commitment the applicant never made.
An optional question does not need to be declarable-unasked anyway.

## Which name a screen shows

One rule, in the one component every vendor-facing screen renders through: **preferred name when present, full legal name otherwise.**

The legal name stays stored and stays visible on the review card, where an organizer is deciding about a person rather than scanning a list.

## Acceptance criteria

- [ ] A new essential question captures the preferred name, optional, asked of every applicant regardless of the plan.
- [ ] It is absent from the required set and from the solver-relevant set, and is not addable to the declarable-unasked list.
- [ ] The shared vendor-identity component shows preferred name when present and legal name otherwise; every screen that renders through it is verified - the vendor list, the tables view and the assignment results.
- [ ] The review card shows both names, labelled.
- [ ] A CSV import can map the preferred-name column; verify against the committed export, whose column is adjacent to the legal name.
- [ ] **No migration.** An existing application with no preferred name still assigns: the solver names the keys it reads explicitly rather than looping over every asked key, and stored applications are not re-validated. Confirm this rather than assuming it.
- [ ] The published schema is regenerated and the test that pins it passes.
- [ ] The front-end mirror of the contract is updated in step.
