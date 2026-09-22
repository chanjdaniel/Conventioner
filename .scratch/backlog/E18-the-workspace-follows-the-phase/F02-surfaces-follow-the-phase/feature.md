---
id: E18/F02
title: Surfaces follow the phase
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

The workspace shows the surface for the market's current phase.
The rail and the workspace say the same thing instead of two different things, and no screen offers an action the phase refuses.

## Why now

Four peer tabs are laid over seven phases with no correspondence.
The consequence an organizer meets: Assignment Priority, Assignment Options and an Assign button all sit in the Market Setup tab beside the dates, and the button is permanently visible and permanently refused until the market reaches the assignment phase.
So a first-time organizer's first screen offers them a control that explains a rule rather than applying it.

Settled in [ticket 01](../../../wayfinding/the-order-of-the-work/issues/01-the-order-of-the-work.md) and [ticket 11](../../../wayfinding/the-order-of-the-work/issues/11-the-three-application-phases.md).

## The shape of this feature

`S01` is a **prefactor** and delivers nothing on its own: the view is one file holding every tab's body inline, and fifteen end-to-end specs drive it by tab.
Extracting the bodies first is what keeps `S02` from being a whole-file rewrite and a fifteen-spec migration in one sitting.

`S02` is the **wide refactor**: it is the story that migrates those specs.
`S03` and `S04` then give two of the resulting surfaces their content, and are deliberately separate because `S02` is already carrying the migration.

## Stories

- `S01` - extract the four tab bodies into components.
- `S02` - the shell routes by phase.
- `S03` - the applications surface states which phase it is in.
- `S04` - the assignment surface.
