---
id: E28/F02/S01
title: The table counts filter the tables
type: story
status: done
blocked_by: []
pr: [#94]
---

## What to build

On the Result page's tables view, each of "301 assigned", "0 partial" and "2 empty" becomes a toggle button that narrows the tables to that state:

- It is a fifth filter, kept in the address like the other four (`?status=empty`), so the view is a link.
- Choosing one adds a removable chip beside the others; clicking the chosen count again clears it, and so does "Clear all".
- **The counts follow the other four filters and ignore their own**: with "empty" chosen, the assigned and partial counts still say how many there are, rather than falling to 0.
- **A count of 0 is shown but cannot be chosen**, by the existing rule that a zero is not a condition to act on.
- The chosen count reads as chosen.

The three pills are one height: today "assigned" is 2px shorter than the other two, because it has no border.

## Acceptance criteria

- [x] Clicking each non-zero count shows only the tables in that state, and the address carries it.
- [x] Opening that address shows the same filtered view.
- [x] With a status chosen, the other counts are unchanged; with a date chosen as well, all three follow the date.
- [x] A zero count is not clickable and says why to assistive technology (disabled, not merely unstyled).
- [x] The chip and "Clear all" clear it.
- [x] All three pills are the same height in every state.
