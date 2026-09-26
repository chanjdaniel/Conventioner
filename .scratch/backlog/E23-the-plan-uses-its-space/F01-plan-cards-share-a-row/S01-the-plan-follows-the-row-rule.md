---
id: E23/F01/S01
title: The row rule is written, and the plan follows it
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

`docs/design-system.md` gains the rule for a screen of cards, and Market Setup's plan follows it:

- **A screen of cards is a two-track grid.**
- **A card is half width unless it declares itself wide.** On the plan, Market Dates and Section Setup are wide; Tier Setup sits beside Location Setup, and How vendors apply beside Application form, in plan order.
- **A card ends at its own content.** Two cards in a row do not stretch to match; the next row starts under the taller. Blank space inside a card reads as something missing.
- **Below 900px of room it is one track**, measured on the room the cards have, not the window.
- **Every card has the same inner gutter.** Tier Setup's rows sit 6px further in than Location's and Section's today.

The rule becomes tokens and a shared class rather than a local decision in the plan tab, so the next screen of cards reaches for it (AGENTS.md, **The Design Language**).
Section Setup keeps the width its columns need (654px): at half width its tier select truncated, which is why the old equal-thirds row was abandoned.

## Acceptance criteria

- [x] At 1920x1080 and 1280x800, Tier and Location share a row, How vendors apply and Application form share a row, and Market Dates and Section Setup span the row.
- [x] With three tiers beside nine locations, the Tier card ends at its content.
- [x] With less than 900px of room, every card is full width, in plan order.
- [x] No select in Section Setup truncates its value at any of those widths.
- [x] Every plan card's rows start at the same inset.
- [x] The rule is in `docs/design-system.md`, and the plan tab uses the shared class rather than its own grid.
- [x] The plan tab stays on the stylelint errors list.
