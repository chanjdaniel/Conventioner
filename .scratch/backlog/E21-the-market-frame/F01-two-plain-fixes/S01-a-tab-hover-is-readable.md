---
id: E21/F01/S01
title: A tab's hover state is readable
type: story
status: done
blocked_by: []
pr: []
---

## What to build

An organizer who moves the pointer over one of a market's tabs (Market Setup, Application Form, Applications, Assignment Results) can still read its label.

Today the label turns the colour of the black bar behind it and disappears.
The hover colour is the border token, a 25% near-black meant for hairlines on white, placed on `--mm-black`.
It is the same class of defect as the invisible archive button AGENTS.md records: a token used on a ground it was never measured against.

Hover should read as a step between the muted resting label and the white active one.

## Acceptance criteria

- [x] Reproduced first in the running app: hovering an inactive tab makes its label unreadable.
- [x] A hovered inactive tab's label meets WCAG AA on the bar, and reads as brighter than the resting label and no brighter than the active one.
- [x] The value comes from a token measured against `--mm-black`, not a new hardcoded colour.
- [x] The Playwright contrast sweep walks the tab bar's **hover** state. It walks no hover state today, which is how this shipped; per AGENTS.md, the sweep is only worth the states it walks.
