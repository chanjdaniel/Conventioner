---
id: E11/F03/S01
title: Place and swap on the Tables view
type: story
status: in-progress
blocked_by: []
pr: [73]
---

## What to build

Two operations on the Tables view, and deliberately no third.

- **Place into an empty seat.**
- **Swap two vendors, atomically.**

A "move" that displaces whoever is already there does not exist: it is how a vendor is silently
unassigned on market day.
Freeing a seat first is safe and mirrors what an organizer physically does.
A swap is atomic because two vendors trading is common enough that three separate operations invites
a half-finished state.

A table holds two seats - `Full Table`, `Half Table (Left)`, `Half Table (Right)` - so **every
placement names a side**.
Moving a half-table vendor into a full table changes their `table_choice` away from what they asked
for; that is allowed, and the UI says so at the moment it happens rather than rewriting the answer
quietly.

Every placement made here is flagged hand-placed, which is what makes it a pin (`E11/F02`).

## Acceptance criteria

- [x] An empty seat can be filled from the Tables view, naming the side.
- [x] Two occupied seats can be swapped in one action, and either both change or neither does.
- [x] There is no control that displaces a vendor without placing them.
- [x] A change that alters a vendor's `table_choice` says so before it is made.
- [x] Every change made here writes through `E11/F01/S01`'s endpoint.
- [x] The view still holds all its content, per `E09/F02/S01`.
