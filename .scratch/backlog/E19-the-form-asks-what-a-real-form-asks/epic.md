---
id: E19
title: The form asks what a real form asks
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

An applicant answers the question an organizer's own form has always asked, in one grid rather than two questions.
Every vendor is called by the name they chose.
A reviewer opens a card that leads with the answers that decide it, instead of a flat dump of everything.

## Why now

The product's acceptance fixture is a real Google Forms export of 232 applications, and the application form cannot ask its central question the way that form asks it.
That export poses one grid - "for each day, choose all table tiers you would be considered for; choose None if you are not available" - so availability and tier are a single answer.
Conventioner asks two: tick your dates, then pick tiers for each.
The importer already understands the real shape and is tested against it; the applicant form is the half that is wrong.

The same export carries a **Preferred Name** column that the product drops, and the review queue renders every answer an application holds in one undifferentiated list.

Charted in [the-order-of-the-work](../../wayfinding/the-order-of-the-work/map.md).
Read tickets [04](../../wayfinding/the-order-of-the-work/issues/04-what-the-form-asks-and-in-how-many-shapes.md) and [05](../../wayfinding/the-order-of-the-work/issues/05-which-answers-matter-for-review.md) before taking any story.

## What is already settled, and must not be re-litigated

- **One input method, not an organizer choice.**
  The combined grid replaces the two questions rather than joining them.
  A setting would mean two applicant UIs, two sets of validation messages and two end-to-end paths alive forever, to express something the storage cannot tell apart.
- **The storage contract does not move, and that is what backwards compatibility means here.**
  Tier preference stays a per-date answer in the plan's tier order, with availability stored separately and derived from the grid.
  The importer already proves the combined question maps onto it losslessly.
  Backwards compatibility is a property of the stored contract, not of the control.
- **Preferred name is essential but not required**, taking the shape the table-share partner already has: asked of everyone, absent from the required set, asked unconditionally because identity does not depend on the plan, and outside the solver-relevant set so correcting a spelling never invalidates a completed review.
- **Review relevance lives on the market, never on the form.**
  Ticket 05 turned on the freeze: an organizer learns which answers they needed *while reviewing*, which is after the form locks.
  A flag on a form field would freeze exactly when it becomes knowable, and could never mark the essential answers, which are not form fields at all.
- **The existing custom-fields-first heuristic goes.**
  It was standing in for the mark this epic adds.

## Features

Sliced 2026-09-22 with `/to-tickets`.
Five stories.

- **[`F01` - One grid for dates and tiers](F01-one-grid-for-dates-and-tiers/feature.md)** - the prefactor that gives the shape rule one owner, then the control that uses it. Two stories.
- **[`F02` - A vendor's preferred name](F02-a-vendors-preferred-name/feature.md)** - captured, imported, and shown everywhere. One story.
- **[`F03` - Review highlights](F03-review-highlights/feature.md)** - marked in the builder and leading the card, then adjustable from the queue. Two stories.

## The frontier, and the shape of the work

**Two stories are startable now:** `F01/S01` (the prefactor) and `F03/S01` (highlights lead the card).
They share no code - one is the essential-questions contract and the import path, the other is the market document, the form builder and the review card - so they can run in parallel.

**`F02/S01` is blocked by `F01/S02` for file contention, not logic.**
Both edit the applicant fields component: one restructures its dates-and-tiers half, the other adds a name field.
They are independent features and the edge exists only to keep them from colliding, so it can be dropped if the two are taken by the same session.

**`F03/S02` is where the feature earns itself.**
An organizer authoring a form is guessing what will matter; a reviewer on card twelve knows - and by then the form has frozen.
`S01` puts the list on the market rather than the form; `S02` is the reason it goes there.

```
F01/S01 ──> F01/S02 ──> F02/S01     shape rule, grid, then preferred name
(prefactor)         (file contention only)

F03/S01 ──> F03/S02                 highlights lead the card, then adjustable mid-queue
```

## Running order against E18

E18 and E19 have no technical dependency on each other.
E18's prefactor extracts the workspace's tab *bodies*, not the form builder or the applicant fields component, so nothing here waits on it.
They are being taken **sequentially by choice**, not because either gates the other - recorded so a later reader does not infer a dependency that was never there.
