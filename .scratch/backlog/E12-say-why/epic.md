---
id: E12
title: Say why
type: epic
status: in-progress
blocked_by: []
pr: [72]
---

## Outcome

An organizer looking at a vendor who has no table can see why, and a market that guarantees
rejections says so before the assignment runs rather than after.

## Why now

The payoff screen lists unassigned vendors by email under a heading and says nothing else.
A walk produced 5 approved applications, 3 placed, **19 of 24 table-slots free** and two vendors
unplaced, with no explanation of the contradiction anywhere on screen - because both had asked for a
tier the market has no sections at.

Resolved by
[readable-journey ticket 04](../../wayfinding/readable-journey/issues/04-when-a-vendor-cannot-be-placed.md).

## The one idea

**No solver code changes.**
The reason is computed on read from the application, the assignment and the plan - not recorded
during the run.
A recorded reason goes stale the moment the plan changes or a manual placement lands; a computed one
is always true of the current state, and it can say *"free, and they could be placed"*, which a
recorded one cannot.

## Sequencing with E11

`F02` builds the vendor date card as one component with three states, and the second state is
`E11`'s pin override.
**Build the card once.**
Whichever of `E12/F02` and `E11/F02/S02` is taken second should find the component already there and
add its state to it.
