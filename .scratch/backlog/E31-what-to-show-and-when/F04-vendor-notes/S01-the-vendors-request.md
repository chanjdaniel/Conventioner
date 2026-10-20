---
id: E31/F04/S01
title: The vendor's request
type: story
status: done
blocked_by: []
pr: [#109]
---

## What to build

A built-in optional question on the application, "Anything else you need from us?", asked by default and switchable off by the organizer like the essential questions.
On the CSV path the import offers it as a target, so a Google Form's "anything else" column maps onto it.
The form started from a CSV does not propose it for such a column: its rules read values, and a header keyword is what [the-form-started-from-a-csv 03](../../../../wayfinding/the-form-started-from-a-csv/issues/03-how-good-are-the-rules-alone.md) measured as unreliable; the organizer maps the column.
It is the vendor's answer: they see and edit it as they do their other answers; the organizer reads it.

## Acceptance criteria

- [x] A form market's application asks it unless switched off; the answer is stored with the application.
- [x] The import maps a column onto it.
- [x] Its key cannot collide with a custom field's (the `essential_` rule, or its own reserved key).
