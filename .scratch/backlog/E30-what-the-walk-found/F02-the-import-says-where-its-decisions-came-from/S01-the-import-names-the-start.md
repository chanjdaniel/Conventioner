---
id: E30/F02/S01
title: The import names the start, and shows what the start set aside
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

- When the saved mapping was written by the form started from a CSV and no import has run, the map step says the mapping came from the start of the form, not "your last import".
- A value the start saved as ignored (fewer than 3 applicants gave it, by [the-form-started-from-a-csv 06](../../../wayfinding/the-form-started-from-a-csv/issues/06-one-answer-two-uses.md)) is listed among the decided values as set aside when the form was started, with its row count, and can be changed there like any other decision.
- The preview's skipped rows say the same: "set aside when the form was started from this file", never "one you chose to ignore".

Reproduce it first with `back-end/tests/test_data/google_forms/fall-2025.csv` through the real Start-from-CSV and Import screens.
The rule that rare values start ignored is a decision and stays; this story changes what the import says about it and where the organizer can change it.

## Acceptance criteria

- [x] First import after a CSV start: no "Restored from your last import"; it names the start.
- [x] Every value the start set aside is listed with its rows and can be matched to an offered value before the preview.
- [x] No skipped row's reason says the organizer chose to ignore something they did not.
- [x] An e2e walks start -> import on the fixture and asserts the wording and the count.
