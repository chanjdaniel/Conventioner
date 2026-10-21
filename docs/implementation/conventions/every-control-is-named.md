---
layer: implementation
kind: convention
describes:
  - front-end/e2e/every-control-is-named.spec.ts
  - front-end/e2e/helpers/accessibleNames.ts
  - front-end/src/components/AnswerValue.vue
  - front-end/src/utils/answerLinks.ts
verified: 2026-10-22
sources:
  - E26/F10/S03
  - bug/44
  - bug/50
  - bug/52
---

# Every control is named

**Every control has a name, and a placeholder is not one**: a `<label for>`, an `aria-label` or an `aria-labelledby`.
A placeholder goes the moment someone types, which is how the plan's name fields and the sign-in code came to be announced as nothing at all (bug 44).

## The rules

**A new screen or dialog joins the walk.**
[`every-control-is-named.spec.ts`](../../../front-end/e2e/every-control-is-named.spec.ts) walks the screens and dialogs with `namelessControls()` ([`e2e/helpers/accessibleNames.ts`](../../../front-end/e2e/helpers/accessibleNames.ts)), which lists every drawn, non-inert form control whose `aria-labelledby` text, `aria-label`, `<label>` or `title` is empty.
**The walk only sees the rows it seeds**: the rules page walked with no rule on it saw the card's "Add a rule" and missed every control inside one (bug 50), so a spec seeds one row of each kind before it walks.

**A field styled `all: unset` loses its focus ring with everything else, so its container draws one** (`:focus-within`), as the plan's tier, section and location cards do.

**Native checks and radios take `accent-color` from `body`**, which sets it once to the product's green in [`front-end/src/assets/base.css`](../../../front-end/src/assets/base.css); a component never sets it for its own inputs.
**No link pads itself**: the global `a` rule carries no padding, so a link sits on the text beside it (bug 52).

**An applicant's answer is rendered through [`AnswerValue.vue`](../../../front-end/src/components/AnswerValue.vue)**, which makes each `http:` or `https:` address in it a link and nothing else ([`answerLinks.ts`](../../../front-end/src/utils/answerLinks.ts)).
The answer is the applicant's own text, so that line is what keeps a `javascript:` address planted in a form from becoming a link.

## How it is enforced

The walk is part of the Playwright suite; the visual side of the same idea (focus rings, the one disabled state) is owned by the primitives in [the design language](../../design-system.md#the-primitive-layer).

## What breaks it

- A field named only by its placeholder, or by text beside it that no `for` or `aria-labelledby` ties to it.
- A screen or dialog added without a step in the walk, or walked before the rows that hold its controls exist.
- An answer rendered with `v-html`, or as plain text where a reviewer needs the link.
