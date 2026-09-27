---
id: E24/F04/S02
title: Start from a draft's Market Setup
type: story
status: done
blocked_by: [E24/F03/S01]
pr: [86]
---

## What to build

The "How vendors apply" card on a draft market's Market Setup carries "Start from my Google Form's responses", which opens the flow.
It is available only while the market is a draft and its form has no questions of its own; otherwise it is disabled and says why.
It leaves the intake mode as it is.

## Acceptance criteria

- [x] On a draft with no custom questions the action opens the flow's Upload step, whatever the intake mode.
- [x] With a custom question on the form, or out of draft, it is disabled with the reason, and the server refuses the proposal regardless.
- [x] Confirming from here does not change the intake mode.
- [x] Playwright: a market with form intake starts from its Google Form here, confirms, and still takes applications on its page.
