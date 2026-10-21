---
layer: business
kind: rule
describes:
  - back-end/csv_proposal.py#NEARLY_ALL
  - back-end/csv_proposal.py#_field
verified: 2026-10-22
sources:
  - E33/F02
  - E33/F02/S01
---

# No question is inferred required

When a market is started from its Google Form's responses, every question of the organizer's own is proposed as not required; only the organizer marks one required.

## Why

The export does not say which questions the form required.
A guess read from how many answered (nearly everyone, so required) skipped, at import, every row that had left such a question blank: applicants who had applied on the organizer's own form, refused by a requirement the organizer never set.

## Where it is kept

- `_field` in [`back-end/csv_proposal.py`](../../../back-end/csv_proposal.py) proposes every question with `required: False`; the ledger lets the organizer tick it, and confirm writes what they sent ([the CSV proposal and start](../../implementation/modules/csv-proposal-and-start.md)).
- `NEARLY_ALL` (0.97) is a fact about a column, never a question's requiredness: it reads a choice nearly everyone gave as a checkbox, and spares a question nearly everyone answered from being taken for a team's column.
- The answer key in `back-end/tests/test_csv_proposal.py` asserts each column's kind, type and options, and no required flag.
