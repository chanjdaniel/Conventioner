---
id: E14/F01/S03
title: A blocker points at its fix
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

`BlockerPanel`'s resolution link reads "Fix this →" and every blocker so far sets it to `/market-setup` - which is where every blocker is raised from.
Clicking it does nothing visible.

The two fixes `NoAskedForTierWithoutTablesGuard` names live in different places: *add a section at that tier* is the Market Setup tab, *reject those applications* is the Applications tab.
The link points at neither specifically.

Give a guard's `resolution_link` the tab that actually holds its fix, and have the panel say nothing rather than offer a link to the current page when the two coincide.

## Acceptance criteria

- [ ] No resolution link navigates to the page it is displayed on.
- [ ] Each guard's link names the tab holding its remedy, where one tab does.
- [ ] A guard whose remedy spans two places offers no link rather than a misleading one.

## Notes

Finding F8 in `.lavish/qc-2026-09-20.html`.
`resolution_link` is already per-guard in `back-end/guards.py`, so this is data, not structure.
