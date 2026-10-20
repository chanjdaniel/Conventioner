---
id: E33/F02/S01
title: The proposal marks nothing required
type: story
status: done
blocked_by: []
pr: [#110]
---

## What to build

The CSV proposal stops inferring requiredness: every proposed custom question is not required, and the organizer can turn it on.
The essential questions keep their own rules.
Hold the change against the hand-written answer key on the five anonymised exports, updating the key's requiredness column.

## As built

- Every proposed question of the organizer's own is `required: False`; the 97% share (`NEARLY_ALL`) is kept only as a fact about a column, for its type and for which columns may be the team's own notes.
- The answer key in `tests/test_csv_proposal.py` lost its requiredness column.
- The real November 2026 export is not in the repository, so the import criterion is held on the five anonymised exports instead (`test_no_row_is_skipped_for_a_blank_answer_to_a_question_of_the_organizers_own`): between 15 and 41 more rows import from each.
- Online enforcement of a required question is `test_a_missing_required_custom_answer_is_refused`.

## Acceptance criteria

- [x] A proposal from any of the five exports marks no custom question required.
- [x] Importing the real November 2026 export after starting from it skips no row for a blank answer to a custom question.
- [x] A question the organizer marks required is still enforced online.
