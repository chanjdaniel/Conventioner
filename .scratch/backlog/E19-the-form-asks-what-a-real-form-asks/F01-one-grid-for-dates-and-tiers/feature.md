---
id: E19/F01
title: One grid for dates and tiers
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

An applicant answers availability and tier as one question, the way an organizer's own form has always asked it.

## Why now

The product's acceptance fixture is a real export of 232 applications, and it poses **one** grid question: *"For each day, choose all table tiers that you would like to be considered for. Choose None if you are not available."*
Availability is implicit in the tier answer.

Conventioner's applicant form asks **two**: tick your available dates, then choose tiers for each ticked date.

The asymmetry runs the opposite way to intuition.
The importer already accepts both shapes and normalises them, with a comment naming the real form's shape as the reason.
**The applicant form is the half that cannot ask the question the way a real form asks it.**

Settled in [ticket 04](../../../wayfinding/the-order-of-the-work/issues/04-what-the-form-asks-and-in-how-many-shapes.md).

## What does not change

The stored contract.
Tier preference stays a per-date answer in the plan's tier order, with availability stored separately and derived.
**Backwards compatibility is a property of the stored contract, not of the control** - which is why no migration is needed and why every downstream reader keeps reading one shape.

## Stories

- `S01` - the shape rule has one owner.
- `S02` - the applicant form asks one grid.
