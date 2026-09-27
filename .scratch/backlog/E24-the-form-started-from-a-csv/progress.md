# E24 progress log

Working branch: `feat/e24-form-from-csv`.
Order: F01/S01 (done, PR #85), F02/S01, F02/S02, F02/S03, F03/S01, F03/S02, F03/S03, F04/S01, F04/S02.

## 2026-09-27

- F02/S01 started.
- Found: the anonymiser replaced every link with example.com, which hides the Drive upload links the `file` type rule reads. Fix: keep the parts of a link that 3 applicants' links share, then regenerate the five fixtures.
