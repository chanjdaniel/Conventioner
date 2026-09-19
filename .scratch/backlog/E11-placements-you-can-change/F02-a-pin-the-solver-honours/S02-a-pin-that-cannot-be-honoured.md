---
id: E11/F02/S02
title: A pin that cannot be honoured
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Three cases, three different answers.

**Two vendors pinned to the same seat on the same date: refused at pin time.**
It is a contradiction rather than a preference the solver can weigh, and the moment to refuse it is
when the second pin is made and the organizer can see both.

**A pin that breaks a filter: allowed, and marked.**
Pinned to a Gold table when the vendor answered Silver-only is a legitimate override, and admins
edit without restriction.
The placement is marked as **overriding the vendor's stated preference** wherever it is shown -
because tier sets the price, and someone will be charged for a table they did not choose.

**A pin the plan no longer satisfies: orphaned, not deleted.**
Deleting the section a pinned seat belongs to, or dropping the section's table count below it,
leaves the pin in place and surfaces it as a **blocker before the next assignment**.
Silent deletion loses a deliberate guarantee without telling anyone; refusing the plan edit makes
pins a lock on the floor plan.
The mechanism exists - `assignment` has an entry invariant and blockers render generically through
`BlockerPanel`, so this is an entry in `guards.py` and nothing new in the UI.

## Acceptance criteria

- [x] A second pin to an occupied seat is refused, naming the vendor already there.
- [x] A filter-breaking pin succeeds and is marked as overriding the vendor's answer.
- [x] Deleting a section with a pin in it does not delete the pin.
- [x] An orphaned pin blocks `-> assignment` with a message naming the vendor and the missing seat.
- [x] Removing or re-placing the orphaned pin clears the blocker.

## Notes

The override marking has no UI of its own.
[Ticket 04](../../../wayfinding/readable-journey/issues/04-when-a-vendor-cannot-be-placed.md) is
resolved: the vendor's per-date card becomes one component with three states, and this override is
the second of them (`E12/F02/S01`).
Whichever of this story and `E12/F02/S01` is taken second adds its state to the component the first
built. **Build the card once.**
