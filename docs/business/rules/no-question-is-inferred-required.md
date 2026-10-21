---
layer: business
kind: rule
describes:
  - back-end/csv_proposal.py#NEARLY_ALL
  - back-end/csv_proposal.py#_field
verified: 2026-10-21
sources:
  - brain-dump/2026-10-19#8
  - E33/F02
  - E33/F02/S01
---

# No question is inferred required

When a market is started from its Google Form's responses, every question of the organizer's own is proposed as not required; only the organizer marks one required.

**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md).

## Why

The export does not say which questions the form required.
A guess read from how many answered (nearly everyone, so required) skipped, at import, every row that had left such a question blank: applicants who had applied on the organizer's own form, refused by a requirement the organizer never set.

## Where it is kept

- `_field` in [`back-end/csv_proposal.py`](../../../back-end/csv_proposal.py) proposes every question with `required: False`; the ledger lets the organizer tick it, and confirm writes what they sent ([the CSV proposal and start](../../implementation/modules/csv-proposal-and-start.md)).
- `NEARLY_ALL` (0.97) is a fact about a column, never a question's requiredness: it reads a choice nearly everyone gave as a checkbox, and spares a question nearly everyone answered from being taken for a team's column.
- The answer key in `back-end/tests/test_csv_proposal.py` asserts each column's kind, type and options, and no required flag.
- `test_no_row_is_skipped_for_a_blank_answer_to_a_question_of_the_organizers_own` (`back-end/tests/test_csv_start.py`) starts a market from each of the five anonymised exports and previews its import: no question is required, and no row is refused for a blank answer to one.
  Online, a question the organizer did mark required is still enforced (`test_a_missing_required_custom_answer_is_refused`, `back-end/tests/test_application_write.py`).

## Evidence

The real November 2026 export is not in the repository, so the rule is held on the five anonymised exports instead: when it was built, between 15 and 41 more rows imported from each than under the 97% guess.
