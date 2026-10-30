---
layer: implementation
kind: convention
describes:
  - front-end/e2e/every-control-is-named.spec.ts
  - front-end/e2e/helpers/accessibleNames.ts
  - front-end/src/components/AnswerValue.vue
  - front-end/src/utils/answerLinks.ts
verified: 2026-10-31
sources:
  - E26/F10/S03
  - bug/44
  - bug/50
  - bug/52
  - T45
  - T75
  - E38/F01/S01
---

# Every control is named

**Every control has a name, and a placeholder is not one**: a `<label for>`, an `aria-label` or an `aria-labelledby`.
A placeholder goes the moment someone types, which is how the plan's name fields and the sign-in code came to be announced as nothing at all (bug 44).

## The rules

**A new screen or dialog joins the walk.**
[`every-control-is-named.spec.ts`](../../../front-end/e2e/every-control-is-named.spec.ts) walks the screens and dialogs with `namelessControls()` ([`e2e/helpers/accessibleNames.ts`](../../../front-end/e2e/helpers/accessibleNames.ts)), which lists every drawn, non-inert form control whose `aria-labelledby` text, `aria-label`, `<label>` or `title` is empty.
**The walk only sees the rows it seeds**: the rules page walked with no rule on it saw the card's "Add a rule" and missed every control inside one (bug 50), so a spec seeds one row of each kind before it walks.

**A control is named by the words it shows, and an `aria-label` that replaces them is a defect** (WCAG 2.5.3): a voice user says what they see.
Words a screen reader needs beyond those go beside them in a `.visually-hidden` span, as a vendor's name says ": their details" and a statistics row says what its count is a share of.
**A control holds no control**: a market row was a `role="button"` around its own Manage button, so the row is now a click target for the pointer only, and its name is the real button the keyboard and a screen reader reach it by ([`SummaryCard.vue`](../../../front-end/src/components/SummaryCard.vue)).
Both are caught by the accessibility sweep ([the design language](../../design-system.md#what-keeps-this-true)), which this walk does not replace: it names what axe cannot judge, a control whose name is empty by intent.

**A field draws no focus ring, and neither does its container**: a text field's caret is its focus indicator, by Daniel's decision (E38/F01/S01, [the design language](../../design-system.md#the-primitive-layer)), so the plan cards' name fields lost the `:focus-within` ring bug 44 gave them.

**Native checks and radios take `accent-color` from `body`**, which sets it once to the product's green in [`front-end/src/assets/base.css`](../../../front-end/src/assets/base.css); a component never sets it for its own inputs.
**No link pads itself**: the global `a` rule carries no padding, so a link sits on the text beside it (bug 52).

**An applicant's answer is rendered through [`AnswerValue.vue`](../../../front-end/src/components/AnswerValue.vue)**, which makes each `http:` or `https:` address in it a link and nothing else ([`answerLinks.ts`](../../../front-end/src/utils/answerLinks.ts)).
The answer is the applicant's own text, so that line is what keeps a `javascript:` address planted in a form from becoming a link.

## How it is enforced

The walk is part of the Playwright suite; the visual side of the same idea (the focus halo, the one disabled state) is owned by the primitives in [the design language](../../design-system.md#the-primitive-layer).
The front end's lint refuses `v-html` anywhere (`vue/no-v-html` as an error in [`eslint.config.ts`](../../../front-end/eslint.config.ts)), so no template can render an answer, or any other text, as raw HTML.

## What breaks it

- A field named only by its placeholder, or by text beside it that no `for` or `aria-labelledby` ties to it.
- A screen or dialog added without a step in the walk, or walked before the rows that hold its controls exist.
- An answer rendered with `v-html`, or as plain text where a reviewer needs the link.
