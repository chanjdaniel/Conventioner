---
id: E16/F03/S03
title: The plan's columns are sized by need
type: story
status: in-progress
blocked_by: [E16/F03/S01]
pr: []
---

## What to build

`.plan-row--triple` is `repeat(3, minmax(0, 1fr))`, which allocates by position rather than by need. Measured by lifting the caps and asking each panel for its `max-content` width:

| Panel | Gets | Wants |
| --- | --- | --- |
| Tier Setup | 460 | 324 |
| Location Setup | 460 | **278** |
| Section Setup | 460 | **654** |

Section Setup packs four columns and a delete control into the same 460 that Location Setup uses for one. That is the sole cause of the Tier select rendering **65px wide with 34px of text room**, while "Premium" needs 56px, "Standard" 57px and "Community" 71px - so every tier reads `Pr...`, `St...`, `Co...` on the field that sets a vendor's price. The Location select truncates "Mezzanine" by 10px for the same reason.

At `--workspace-max` with two 30px gaps, 1,380 is available and the content fits with room: roughly Tier 340, Location 300, Section 660.

Unequal columns are already accepted here - `.plan-row--asymmetric` is `3fr 2fr`.

**Nothing else may fix the tier select.** It is not a widget bug, and `E15` deliberately does not touch it.

While here: the column headers (`Section Name / Location / Tier / Count`, `Priority / Tier Name`, `Date`) are non-interactive labels rendered with the same border, inset shadow and centred text as the editable pills beneath them. They are the header row of the grid this story rebuilds, so give them a header's appearance (finding H10).

## Acceptance criteria

- [x] No `<select>` or `<input>` on the plan is narrower than its own longest option or value. Asserted by measuring the rendered text width of the selected option against the control's available width, for every control on the plan.
- [x] `Community`, `Standard`, `Premium`, `Mezzanine` and `Main Hall` all render in full.
- [x] The three panels' widths are within ~10% of what their content needs, not equal to each other.
- [x] Column headers are visually distinct from the editable controls beneath them and expose no interactive element.

## Notes

The acceptance test here is worth writing carefully: it is the one that stops a fifth instance. A market with a long tier name ("Community Makers") and a long location ("Waterfront Plaza North") belongs in the fixture.
