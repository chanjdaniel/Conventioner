---
id: E22/F04/S05
title: The statistics open under the result
type: story
status: ready
blocked_by: [E22/F04/S04]
pr: []
---

## What to build

**Statistics** on the Result page's strip opens an inline panel under the strip, closed by default, holding the per date, per section, per tier and per table choice counts.
It is a panel and not a dialog: `AppDialog` is one small job (AGENTS.md, **Dialogs**), and this is reading.
A count that names a date, a section or a tier filters the grid below to it, as the old results page's counts linked to Tables.

## Acceptance criteria

- [ ] The panel is closed on arrival and opens and closes from the strip, without moving the grid's filters.
- [ ] Every count the old results page showed is in the panel, from the same statistics read.
- [ ] Choosing a date, section or tier count filters the grid to it.
- [ ] The panel's open state is part of the address, so a refresh keeps it.
