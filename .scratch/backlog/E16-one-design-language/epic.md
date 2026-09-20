---
id: E16
title: One design language
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

Conventioner has one written design language, enforced by checks, and every surface is on it.
`docs/design-system.md` is the statement; this epic is the work of making it true.

## Why now

The 2026-09-20 walk (`.lavish/aesthetics-2026-09-20.html`) found that the individual screens the recent epics built are good, and that what is wrong is not on any one screen: **there is no shared component layer.**
12,211 lines of CSS in 71 scoped `<style>` blocks, each re-deciding radius, spacing, type and colour from scratch.

The measured result: 17 distinct `border-radius` declarations, 24 font sizes using essentially every integer from 11px to 20px, 32 spacing values, 351 hardcoded hex colours against 704 token uses, nine reds for one semantic role, and five typefaces rendering at once.

The newer work converged on something coherent - 6px controls, 10px cards, a three-layer shadow, 12px gaps - so the product does not need a look inventing. It needs the look it already has written down and applied to the files that predate it.

Two findings escalate this beyond tidiness:

- **`--mm-red` and `--mm-text-red` are referenced but never defined.** One consequence is that the **Archive Market** confirmation button renders as white text on a white dialog with no border. It is invisible, on the only irreversible action in the product.
- **65 declarations ask for a font weight that was never loaded**, so every emphasis in the product is a browser-synthesised smear. (That one is [E15/F01/S02](../E15-corrections-the-third-walk-found/F01-controls-the-product-never-styled/S02-the-weights-are-already-in-the-repo.md), because it needs no system.)

## The decisions this epic executes

Taken 2026-09-20 and recorded in `docs/design-system.md`. They are not open here.

- The card idiom is **extracted** from the newer screens; the type and spacing scales are **authored**, because there was nothing to extract.
- Tokens are not enough. A **primitive layer** (`.btn`, `.field`, `.chip`) owns height, padding, radius, type, focus and disabled state, because every control finding is a height or a padding and no variable can express those.
- The brand green is `--mm-green` (`#36826f`); the logo is restyled to it.
- Two page widths, not four: `--workspace-max: 1440px` and `--list-max: 1100px`. No screen caps its own height; no row carries a minimum height; columns are sized by need. (Ticket 01.)
- `--mm-red: #c0392b` and `--mm-blue: #1a6f8b`.
- Three checks keep it true: stylelint, a custom-property resolution check, and a rendered-usage contrast sweep in Playwright.

## Shape

The token layer goes first because it is pure addition, has no layout implications, and closes the invisible-button bug in days rather than behind a layout decision.

**Nothing in this epic is blocked on a decision any more.** [claims-and-room ticket 01](../../wayfinding/claims-and-room/issues/01-how-an-organizer-screen-sizes-itself.md) was the one external blocker and it resolved on 2026-09-20; its build is `F03`. What remains is ordinary sequencing: the primitives come after `F03` because a `.field` has to be wide enough for its own content, and the Tier select is 65px only because the plan's columns are equal thirds.

Then one slice at a time. **Each slice is a feature, reviewed and shipped on its own.** A single diff across 71 files is unreviewable, and migrating opportunistically leaves the two languages coexisting with no end date, which is the exact condition this epic exists to end.

## Features

- `F01-every-colour-has-a-name` - define the missing tokens, close the invisible button, retire the nine reds and two blues, fix the two failing verdict buttons and the rail ground, restyle the logo, add the resolution check and the contrast sweep. **Startable now.**
- `F02-the-scale-written-down` - type, spacing, radius and elevation tokens in `base.css`; stylelint bans raw values outside it. No migration. **Startable now.**
- `F03-the-sizing-model` - two widths replace four, the page scrolls instead of the card, plan columns are sized by need. The build of ticket 01. **Startable now.**
- `F04-the-primitives` - `.btn`, `.field`, `.chip`. After `F02` and `F03`.
- `F05-slice-the-auth-screens` - three files, never covered by any walk, and H2's worst case.
- `F06-slice-the-lists-and-the-dashboard`
- `F07-slice-the-market-workspace` - also after `F03`.
- `F08-slice-the-public-surfaces`

The four slices get their stories written when `F04` lands. A story that says "use the primitive" before the primitive exists is not a story, and the shape of each slice depends on what the three primitives turn out to cover.

## What this epic is not

It does not decide what a screen should *say* or *emphasise*.
What a market row's button should do, what the dashboard is for, what a triage card leads with, what an empty state is in this product - those are open decisions that want their own map, charted after `claims-and-room` closes.
A token scale fixes none of them, and folding them in would redraw this outcome from *how it looks* to *how it works*.
