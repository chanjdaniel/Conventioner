---
id: E17/F01/S01
title: One add-row control, adopted by all five plan cards
type: story
status: done
blocked_by: []
pr: []
---

## What to build

Every plan card on the Market Setup tab gets the same control for adding a row: the same icon at the same size, the same label treatment, the same hit area, centred the same way.

An organizer moving between Market Dates, Tier Setup, Location Setup, Section Setup and Assignment Priority sees one control, not five variations of one.

The control is defined once in the primitives layer and adopted by the five cards.
This is the prefactor that makes the fix trivial: extracting it is what lets five call sites collapse to one class each, rather than five files each keeping their own copy.

## Why it is broken today

Measured in the running app at 1920x1080 against a market with a populated plan:

- **Assignment Priority's icon renders 24x24; the other four render 40x40.**
  Its markup applies a class that is defined nowhere, while the class that carries the 40x40 rule is applied by the other four.
- **Inside Assignment Priority's control, the icon and its label do not agree.**
  The icon's horizontal centre sits at x=946 and the label's at x=975 - **29px apart** - because the wrapper is a plain block, so the inline icon sits at the left edge on one line and the block label takes the full width on the next.
- **The wrapper class used by four of the five cards has no rules anywhere in the repo.**
  Those four look centred only because the parent rows container happens to be a flex column with `align-items: center`. Nothing states that intent, so nothing protects it.
- **The 40x40 icon rule is declared identically in five separate files.**

## Acceptance criteria

- [ ] The add-row control is defined once in `front-end/src/assets/primitives.css`, carrying its own size, padding, internal gap, hit area and alignment - not inheriting centring from whatever its parent happens to be.
- [ ] All five plan cards use it: Market Dates, Tier Setup, Location Setup, Section Setup, Assignment Priority.
- [ ] Measured in the browser, the icon's horizontal centre and the label's horizontal centre agree to within 1px in every card that has a label.
- [ ] Measured in the browser, the control's icon renders at the same width and height in all five cards.
- [ ] Measured in the browser, the control's horizontal centre agrees with its card body's horizontal centre to within 1px in all five cards.
- [ ] No class name in any of the five cards' markup fails to match a rule; the duplicated icon rule is gone from all five files.
- [ ] `src/__tests__/primitives.test.ts` covers the new control the way it covers `.btn`, `.field` and `.chip`.
- [ ] `npm run lint:css` passes; all five files are already on the per-file error list, so regressions fail the build.
