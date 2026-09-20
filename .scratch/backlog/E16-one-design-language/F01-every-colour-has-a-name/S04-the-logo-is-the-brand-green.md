---
id: E16/F01/S04
title: The logo is the brand green
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The wordmark paints `#00DC82`; every primary button paints `--mm-green` (`#36826f`). They sit 40px apart in the header on every screen.

`#00DC82` gives white text 1.7:1 and black text 11:1, so it can never be a button, a link or a label - a brand colour the product would be forbidden from using on any control. It is also a widely-recognised framework's stock brand green, which reads as an unreplaced template.

Restyle the mark to `--mm-green`.

While here: `#49b096` is still in the source in six rules plus a tinted shadow on the Markets list. `base.css` records that value as the green that was **darkened away for failing contrast at 2.65:1**. Retire it.

## Acceptance criteria

- [ ] The wordmark and the primary button are the same green.
- [ ] `#00dc82` and `#49b096` appear nowhere in `front-end/src` or `public/`.

## Notes

Startable now, independent of the other stories.
Evidence: `.lavish/aesthetics-2026-09-20.html`, S6.
