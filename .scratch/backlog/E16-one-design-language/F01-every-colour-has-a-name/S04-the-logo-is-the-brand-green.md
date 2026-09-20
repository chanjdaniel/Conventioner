---
id: E16/F01/S04
title: The logo is the brand green
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

The wordmark and the primary button are different greens. **The value in the report was wrong and is corrected here.**

The walk recorded the logo as `#00DC82` from a runtime probe. That cannot have been the logo: the wordmark is an `<img src="conventioner-logo.svg">`, and an `<img>`'s internals are not in the DOM. `#00DC82` appears nowhere in this repository - it was the **Vue DevTools** overlay's own icon, read by a probe that ran before the walk learned to exclude it.

The real value is **`#4EE2AA`**, in `src/assets/icons/conventioner-logo.svg`. The finding survives the correction: it gives white text 1.64:1, so it can never be a button, a link or a label - a brand colour the product would be forbidden from using on any control - and it is 40px from a `--mm-green` button in every header.

Restyle the mark to `--mm-green` (`#36826f`).

While here: `#49b096` is still in the source in six rules plus a tinted shadow on the Markets list. `base.css` records that value as the green that was **darkened away for failing contrast at 2.65:1**. Retire it.

## Acceptance criteria

- [x] The wordmark and the primary button are the same green.
- [x] `#4EE2AA` and `#49b096` appear nowhere in `front-end/src` or `public/`.

## Notes

Startable now, independent of the other stories.
Evidence: `.lavish/aesthetics-2026-09-20.html`, S6.
