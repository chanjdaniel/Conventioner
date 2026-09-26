---
id: E17/F03/S01
title: The application form tab reads clearly
type: story
status: done
blocked_by: []
pr: []
---

## What to build

One screen, one verification pass.
An organizer on the application form tab can tell one added field from the next, reads every caption on the centre line of the control it names, finds the toggle that decides whether a question is asked where an action belongs rather than in a heading row, and can read every badge on the screen.

## Why it is broken today

**Nothing delineates one added field from the next.**
The list puts `8px` between two fields and `6px` within one, so a row of the same field and the start of the next sit the same distance apart and proximity gives the eye nothing to group on.
The container the markup calls a card declares no border, background, padding or radius - each "card" is an unbounded stack of rows.
The essential-questions panel beside it *does* bound each question, so the two halves of one screen disagree about whether a form field is a card.

**The add-a-field editor's captions are not on their controls' centre line.**
The obvious fix will not work: the row already declares `align-items: center`, so the label box and the control box are already centred against each other.
The misalignment is **inside** the boxes - the caption has no `line-height` while the control has an explicit height and padding, so two centred boxes still put their text on different lines.
The type control is a `<select>` wearing the same class as the two text inputs; a select given an explicit height and no `line-height` centres its text by its own rules, so it may be off by a different amount than the inputs.

**The "Ask this" toggle reads as a label.**
On the section-preference card it sits in the header beside the type badge, pushed right, so it reads as a third label in the title row rather than as the control that decides whether the question is asked at all.
It belongs at the card's bottom right.

**The field-type badge fails contrast** at **3.73:1**, below AA at the size it is set in.
It puts muted text on the border token as a fill - and that token is exempt from the token contrast test precisely because it "never carries text".

## Acceptance criteria

- [ ] The space between two added fields is clearly greater than the space within one; the relationship is the criterion, not a specific number.
- [ ] A decision is made and recorded in the PR on whether an added field becomes a bounded card, and it agrees with the essential-questions panel beside it rather than contradicting it.
- [ ] The `Label`, `Key` and `Type` captions are optically centred against their controls. Verify each of the three separately by measuring text baselines in the browser, since the `<select>` may differ from the two inputs.
- [ ] The `Required` row and the `Options` row are checked too: the first pairs a caption with a bare checkbox that has no control height, the second with a column of rows. Record what the `Options` caption aligns to - the first row rather than the stack's midpoint - and why.
- [ ] The "Ask this" toggle sits at the bottom right of the section-preference card, and the card still reads correctly in all three of its body states: the not-asked hint, the ranked section chips, and the no-sections-yet warning.
- [ ] The field-type badge meets AA at its size; verify by computing the ratio, and state the before and after numbers in the PR.
- [ ] `contrast.test.ts` is extended so that this usage - not merely the token - is covered, or the reason it cannot be is recorded.
- [ ] `npm run lint:css` passes.
