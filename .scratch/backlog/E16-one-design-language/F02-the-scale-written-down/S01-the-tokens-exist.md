---
id: E16/F02/S01
title: The tokens exist
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Add to `base.css`, from `docs/design-system.md`:

- **Type**, six steps: 12 / 14 / 16 / 20 / 26 / 32. Nothing below 12px; the product currently ships 10px and 8px body text.
- **Spacing**, a 4px grid: 4 / 8 / 12 / 16 / 24 / 32 / 48, plus a single 2px hairline exception for icon-to-label gaps, which is not a step and is not laid out on.
- **Radius**, three values: 6 controls / 10 cards / 999 pills.
- **Elevation**, one shadow, the three-layer one already used 77 times on the Assignment Results screen.

Follow `base.css`'s existing house style: each token carries a comment saying what it is for and what it replaced. That file's comments are the reason the colour work held up, and the same discipline is what will stop a seventh spacing value being added quietly.

No component changes in this story.

## Acceptance criteria

- [x] Every token in `docs/design-system.md` exists in `base.css` with a comment.
- [x] Nothing renders differently: this story is additive and a visual diff should be empty.

## Notes

Startable now.
