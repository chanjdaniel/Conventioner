---
id: E17/F01/S03
title: Plan-card headings and values share one grid
type: story
status: ready
blocked_by: [E17/F01/S01, E17/F02/S01]
pr: []
---

## What to build

In every plan card, a column heading sits directly above the values it names, and every column that exists in a row has a heading above it.

An organizer scanning down a column sees one column, not a heading that is slightly to one side of its own values.

## Why it is broken today

Measured in the running app at 1920x1080, on a market with a populated plan.
The walk's finding said "check what is meant to be centred"; the measurements say the problem is narrower and more specific than that.

**Tier Setup is the only card whose headings and values are laid out on different grids.**

```
Tier Setup   heading row : 49.66px  198.34px  32px
             data row    : 42px     206px     32px
```

The column boundary falls at x=655 in the heading row and x=648 in the data rows - a **7.66px drift** - so "Priority" and "Tier Name" each sit off the columns they name.
The other four cards' heading and data grids match exactly, to the pixel.

**Two cards omit the heading placeholder for their remove column**, which the other two include:

| Card | Heading cells | Row cells | Grid tracks |
| --- | --- | --- | --- |
| Market Dates | 1 | 2 | 2 |
| Tier Setup | 3 | 3 | 3 |
| Location Setup | 2 | 2 | 2 |
| Section Setup | 4 | 5 | 5 |
| Assignment Priority | 4 | 4 | 4 |

Market Dates and Section Setup declare one fewer heading cell than they have tracks.
Their boundaries happen to line up today because the tracks are shared, so this is a latent inconsistency rather than a visible break - but it means two cards are one implicit-placement change away from a real misalignment.

**Row inset is inconsistent between cards**: measured against each card body's padding box, rows sit 0px in on Section Setup, 4px in on Market Dates and Location Setup, and 9px in on Tier Setup and Assignment Priority.

## Why it is blocked

`E17/F01/S01` places the add control and `E17/F02/S01` makes the rows render whole.
Judging column alignment against rows that are still clipped, or against an add control that is still mis-sized, means measuring twice.

## Acceptance criteria

- [ ] In all five plan cards, the heading row and the data rows resolve to the **same** computed `grid-template-columns`. Verify by reading the computed value in the browser, not by eye.
- [ ] Tier Setup's heading and data column boundaries agree to within 1px.
- [ ] Every card declares as many heading cells as its grid has tracks; the remove column gets an empty heading placeholder in Market Dates and Section Setup, matching Tier Setup and Location Setup.
- [ ] Row inset from the card body's padding box is the same value in all five cards; state the chosen value in the PR.
- [ ] Within a row, each value is aligned consistently with its own heading - the heading and the value agree on left, centre or right per column, and the choice is the same in every card for the same kind of column.
- [ ] Measurements are taken against a market with a populated plan at 1920x1080, and the before/after numbers are quoted in the PR.
