---
id: E09/F02/S03
title: Labels do not break mid-word
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

At 1280x720 the Assignment Results action card renders "View Attendan / ce". That width is no
longer a target (see the epic), so this is **not urgent** - but the cause is wrong at any width and
the sweep is a one-line change.
Its label span sets `overflow-wrap: anywhere`, which is the wrong property for a two-word English label: it permits a break at any character rather than at a word boundary.

Sweep the same property everywhere it is set on short labels.

## Acceptance criteria

- [ ] "View Attendance" reads as two whole words at 1920x1080, and does not break mid-word if the
      card is ever narrower.
- [ ] No short label in the product uses `overflow-wrap: anywhere`; long unbreakable data such as an email address may keep it.
- [ ] The three actions in that card share a baseline.
