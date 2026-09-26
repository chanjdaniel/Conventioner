---
id: E22/F04/S01
title: Every market screen is one width
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

An organizer moving between a market's screens sees the frame stay the same width: every market screen is `--workspace-max`.
Tables, Vendors and Attendance are `--list-max` today, so the frame jumps 340px narrower between tabs and the market's name is cut ("Journey E2E 17904063038…") on the narrower ones.

The market's name ellipses only when the bar genuinely runs out of room beside its tabs, and its full name is available on hover.

## Acceptance criteria

- [x] Reproduced first: at 1920x1080 the frame on Tables is narrower than on Market Setup, and a long market name is cut.
- [x] Every market screen's frame is the same width at 1920x1080 and 1280x800.
- [x] A long market name is shown whole wherever it fits, and ellipsed (with its full name on hover) only where it does not.
- [x] `docs/design-system.md` says which width a market screen is.
