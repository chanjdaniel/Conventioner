---
id: E28/F04/S02
title: The centred marks are centred
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

- **The month arrows** on the market dates calendar: the ‹ and › sit in the middle of their 28px buttons (2.25px low today) and are sized to read beside the month heading (their ink is 3x5px today).
- **The "current" dot** beside a market page link ("Result") and beside a market bar tab: centred on the label's capitals (about 1.5px low today, in both places).
- **The dot reads on the dark market bar**: its green is faint there today.

## Acceptance criteria

- [x] Each arrow's ink centre is within 0.5px of its button's centre.
- [x] Each dot's centre is within 0.5px of the cap-height centre of its label, for the page links and the bar tabs.
- [x] The dot on the market bar meets 3:1 against the bar (non-text contrast).

## Notes from the build

- The dot was already 3.39:1 on the bar, above the 3:1 non-text bar; `contrast.test.ts` now pins it rather than the colour changing.
