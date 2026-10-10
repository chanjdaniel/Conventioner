---
id: E28/F04/S01
title: The seat button's hint sits at its top right
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

On the Result page's tables grid, a seat button's hint ("Change" on an occupied seat, "Place someone" on an empty one) sits in the button's top right corner, level with the name line, on every seat.
Today it floats just right of the occupant's details, so it moves with the length of their email.
It still shows only on hover and keyboard focus.

In the same button:

- **An empty seat is as tall as an occupied one** (36px against 56px today, though the code says they match).
- **A full-table occupant's name is bold**, as intended: the weight is set on a wrapper and the global reset stops the name inheriting it.

## Acceptance criteria

- [x] On hover and focus, the hint's right edge is the button's padding edge and its top is level with the name, for long and short emails and for empty seats.
- [x] Empty and occupied seats are the same height.
- [x] A full-table occupant's name computes to weight 600.
