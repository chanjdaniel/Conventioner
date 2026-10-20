---
id: E33/F01/S02
title: A Google Form market's steps
type: story
status: done
blocked_by: [E33/F01/S01]
pr: [#110]
---

## What to build

A Google Form market's form tab has three steps: essential questions, your questions (proposed from the CSV when the market was started from one), and review setup.
There is no preview step, and nothing on the tab describes what an applicant would see: on this path nobody fills the form in.
The import mapping stays in the import, where the file is.

## As built

- The steps follow `intakeModeOf(market)`: a Google Form market has no Preview step.
- On that path the essential questions say what the import reads (the email column, "the import does not read this until..."), never what an applicant would see, and the field editor offers no "hint shown to applicants".
- Specs that build a market for the form's preview now say `intakeMode: 'form'`; they had been walking a Google Form market, the default.

## Acceptance criteria

- [x] A Google Form market's form tab shows three steps and no preview.
- [x] A form market's tab is unchanged from `S01`.
