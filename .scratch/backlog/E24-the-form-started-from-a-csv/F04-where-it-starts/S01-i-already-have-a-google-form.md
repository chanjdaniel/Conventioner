---
id: E24/F04/S01
title: I already have a Google Form, at creation
type: story
status: done
blocked_by: [E24/F03/S01]
pr: [86]
---

## What to build

The new-market dialog asks, beside the organization and the name, how the organizer starts: "I already have a Google Form" or "Start from scratch".
"I already have a Google Form" creates the market with CSV intake and lands on the flow's Upload step instead of Market Setup; "Start from scratch" is today's behaviour.

The market exists from the dialog's submit, as today: leaving the flow leaves an ordinary empty draft with CSV intake, and `S02`'s action takes the organizer back in.

## Acceptance criteria

- [x] The choice defaults to "Start from scratch", so today's path is one click as before.
- [x] "I already have a Google Form" stores CSV intake and lands on the Upload step.
- [x] The dialog keeps the product's dialog contract: Enter submits, the choice is reachable by keyboard.
- [x] Playwright: create a market this way, leave at Upload, and find a draft with CSV intake and nothing else written.
