---
id: E26/F09/S01
title: Auto-Place fills the plan
type: story
status: done
blocked_by: []
pr: [88]
---


## What to build

Auto-Place asks how many tables of each type to place, shows what it placed, the calibration result is labelled the right way round, a drag started off the image still draws, and the choice dialog's copy matches the wizard.

Closes bugs 38 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] Auto-Place with a count of 20 places 20 tables where they fit, and says how many it placed.
- [x] The calibration result reads px per mm correctly.
- [x] The choice dialog makes no claim the wizard does not deliver.
