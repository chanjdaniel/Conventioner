# E24 progress log

Working branch: `feat/e24-form-from-csv`.
Order: F01/S01 (done, PR #85), F02/S01, F02/S02, F02/S03, F03/S01, F03/S02, F03/S03, F04/S01, F04/S02.

## 2026-09-27

- F02/S01 started.
- Found: the anonymiser replaced every link with example.com, which hides the Drive upload links the `file` type rule reads. Fix: keep the parts of a link that 3 applicants' links share, then regenerate the five fixtures.
- F02/S01 built: `back-end/csv_proposal.py` and `POST /markets/<id>/csv-proposal`.
  The answer key passes: every kind, every type but the two clubs misses (marked "could allow several answers"), every required flag, and option recall 0.98 with none invented.
- F02/S01 reviewed and fixed. An upload column is proposed as text with a link, since the form has no file type (recorded on the story).
  The essential questions' order now lives once, in `essential_fields.ESSENTIAL_QUESTIONS`.
- F02/S02 built: the proposal's `plan` carries the dates, the fitting year, the tiers best first and the ceiling with its sentence.
  All five fixtures match ticket 03's answers, and a plan's own dates and tiers are matched rather than added to.
