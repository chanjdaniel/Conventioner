---
id: E01/F04/S01
title: Detect a grid whose question spans several lines
type: story
status: done
blocked_by: []
pr: [60c177f5]
---

## What to build

Google Forms writes a checkbox grid as one column per option, with the option in trailing brackets:
`Which days? [Monday, November 17]`. Conventioner folds those back into one question.

It only does so when the whole header is on one line. `_GRID_HEADER` in `back-end/csv_import.py`
uses `.` with no `re.DOTALL`, and a real grid question carries its instructions above the bracketed
option - five lines of them in the export this was found with. So the five day columns arrived as
five unrelated columns, each competing for the one "Available dates" target, and the import could
not be completed at all: Preview never enabled.

Fixing it turned a 31-row unusable ledger into a clean 14-row one with the grid detected, verified
by re-uploading the same rows with only the header newlines removed.

## Acceptance criteria

- [x] A grid whose stem spans several lines is detected as one question.
- [x] The group's stem is readable when shown to the organizer - the newlines collapse to spaces rather than appearing raw in the ledger label.
- [x] A single bracketed column is still not a group, multi-line or not.
- [x] A back-end test asserts this against `tests/test_data/google_forms_export.csv`, not a hand-written header. Every existing test used a short single-line stem, which is exactly why this shipped.
