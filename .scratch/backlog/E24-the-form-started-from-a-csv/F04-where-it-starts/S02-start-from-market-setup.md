---
id: E24/F04/S02
title: Start from a draft's Market Setup
type: story
status: ready
blocked_by: [E24/F03/S01]
pr: []
---

## What to build

The "How vendors apply" card on a draft market's Market Setup carries "Start from my Google Form's responses", which opens the flow.
It is available only while the market is a draft and its form has no questions of its own; otherwise it is disabled and says why.
It leaves the intake mode as it is.

## Acceptance criteria

- [ ] On a draft with no custom questions the action opens the flow's Upload step, whatever the intake mode.
- [ ] With a custom question on the form, or out of draft, it is disabled with the reason, and the server refuses the proposal regardless.
- [ ] Confirming from here does not change the intake mode.
- [ ] Playwright: a market with form intake starts from its Google Form here, confirms, and still takes applications on its page.
