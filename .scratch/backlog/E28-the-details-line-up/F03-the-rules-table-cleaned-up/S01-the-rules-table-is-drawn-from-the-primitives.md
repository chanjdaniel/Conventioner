---
id: E28/F03/S01
title: The rules table is drawn from the primitives
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

On the assignment page, the priority rules table, measured on 2026-10-10 against a market with two rules:

- **The answers are a ranked list with a left edge.**
  Each row is handle, rank, answer, then the remove × at the row's right edge, so the ranks and the ×s form columns.
  Today each row is centred, so they move with the answer's length (79px apart on one rule).
- **The answer × is quieter than the rule ×**: smaller and muted, so removing an answer does not look like removing the rule (both are 24px today).
- **"Add an answer" and the question picker are the product's field**, bordered and at the control height, not borderless selects (one is 20px tall, pressed to the cell's foot; the other stretches the whole row).
- **One text colour and one size**, from the tokens (today: slate, pure black and muted, at 14.04px and 14px).
- **1px dividers**, as everywhere else (3px today).
- **Each heading stands over its own column**, left-aligned with it, and the rank sits under "Priority".
- **"Add a rule" is the button primitive.**
- **No scrolling box inside the cell**: a rule with many answers makes the row taller, since the page scrolls.
- The two drag handles are one size.

## Acceptance criteria

- [ ] With answers of different lengths, ranks and ×s line up in columns.
- [ ] Controls are `.btn` / `.field` from `primitives.css`; the file joins the `lint:css` error list.
- [ ] A rule with 12 answers grows the row; nothing scrolls inside it.
- [ ] Every control is named (`every-control-is-named.spec.ts` walks the page with a rule on it).
- [ ] Drag to reorder rules and answers still works.
