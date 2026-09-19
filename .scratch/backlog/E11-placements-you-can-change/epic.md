---
id: E11
title: Placements you can change
type: epic
status: proposed
blocked_by: []
pr: []
---

## Outcome

An organizer can guarantee a vendor a particular seat before the solver runs, and move a vendor
between seats after it has, with a record of who changed what.

## Why now

Nothing in the product can change a single placement.
No endpoint writes one - the only writer of `assignmentObject` is a whole-market PUT - and there is
no affordance anywhere in the UI.

That is load-bearing for a decision already taken.
[Ticket 01](../../wayfinding/readable-journey/issues/01-one-lifecycle-model.md) froze `Assign` past
the `assignment` phase, on the basis that a market-day change is made by hand.
Until hand-editing exists, an organizer whose vendors drop out on the morning of the market has no
move but to archive a running market, so **`E10/F03/S02` is blocked on this epic**.

The shape is settled by
[ticket 08](../../wayfinding/readable-journey/issues/08-where-a-manual-placement-lives.md).
Read that answer before taking any story here.

## The one idea

A pin **is** a hand-placed `VendorAssignmentResult` row, flagged.
There is no separate constraint object.
Pinning before a solver run means writing a row early; the solver treats flagged rows as fixed and
places everyone else around them.
Everything in this epic follows from that.

## Out of scope

- Pinning to a section rather than an exact seat.
  The one-object model cannot express it, and that was accepted.
- A history of anything but placements.
  Phase transitions, plan edits and form edits are not covered; review verdicts already have their
  own record in the application's status.
