---
id: E31/F04/S01
title: The vendor's request
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

A built-in optional question on the application, "Anything else you need from us?", asked by default and switchable off by the organizer like the essential questions.
On the CSV path the import offers it as a target, so a Google Form's "anything else" column maps onto it (and the form started from a CSV proposes it for such a column).
It is the vendor's answer: they see and edit it as they do their other answers; the organizer reads it.

## Acceptance criteria

- [ ] A form market's application asks it unless switched off; the answer is stored with the application.
- [ ] The import maps a column onto it.
- [ ] Its key cannot collide with a custom field's (the `essential_` rule, or its own reserved key).
