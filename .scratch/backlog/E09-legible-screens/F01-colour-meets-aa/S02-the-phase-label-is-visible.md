---
id: E09/F01/S02
title: The phase label is visible
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

`PhaseControlPanel` renders a "Current Phase:" label in `rgba(255,255,255,.7)` on a transparent panel whose nearest painted ancestor is white.
It is laid out at 93x22px and is invisible.
The panel was styled for a dark surface and is rendered on a light one.

The label gets an ink colour, and the rest of the panel is checked for the same mistake.

## Acceptance criteria

- [ ] "Current Phase:" is legible, at AA, on the page background it actually renders against.
- [ ] Nothing else in the panel is styled for a surface it does not sit on.
- [ ] The current-phase pill is visually distinguishable from the buttons beside it.

## Notes

**Narrowed 2026-09-19.**
[Ticket 01](../../../wayfinding/readable-journey/issues/01-one-lifecycle-model.md) is resolved: the
strip is replaced by a rail below the market header carrying the lifecycle spine, with back and
destructive edges in a secondary menu (`E10/F01`).
"The strip reads as label plus state plus actions" was an acceptance criterion here; it is now that
feature's whole job, and has been removed from this story.

What survives here is the one-line defect that holds whichever control ships: a label rendered in
`rgba(255,255,255,.7)` on a white page is invisible, and the rail will need a label too.
Fix the colour; do not rebuild the control.
