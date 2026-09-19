---
id: E09/F03/S02
title: Selects show their placeholder instead of rendering blank
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Two places bind a `<select>` to a value that matches no option, so the control renders **completely empty** - no text, and on the setup rows no border either, so it does not read as a control at all.

- **Section Setup.** A fresh row's Location and Tier selects report `selectedIndex: -1`.
  The "Select a location" and "Select a tier" placeholder options exist and are never selected.
- **CSV import, Map columns.** Every unmapped column's "MAPS TO" select reports `selectedIndex: -1`, because `columnTarget[index]` is `undefined` rather than `''`.
  The "Ignore this column" option exists and is never shown, so an unmapped column is indistinguishable from one that has not loaded.

## Acceptance criteria

- [ ] A new section row shows "Select a location" and "Select a tier".
- [ ] An unmapped import column shows "Ignore this column".
- [ ] No `<select>` in the product can reach `selectedIndex: -1` through normal use.
- [ ] The setup-row selects carry a border, so they read as controls beside the bordered name field and count field in the same row.
