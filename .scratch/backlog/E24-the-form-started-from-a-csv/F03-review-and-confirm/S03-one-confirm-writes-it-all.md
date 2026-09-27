---
id: E24/F03/S03
title: One confirm writes it all
type: story
status: done
blocked_by: [E24/F03/S02]
pr: [86]
---

## What to build

"Create the form and plan" writes, in one request, everything the ledger holds, and lands the organizer on the Application Form tab:

- **the plan facts**: dates and tiers only where the plan has none; the plan's own values win;
- **the form**: each question of the organizer's own with its label, help text, key, type, required and kept options, in file order; the essential questions no column answers marked not asked; written through the form's one writer, so the form lock still holds;
- **the ceiling**, into the assignment rules;
- **the import mapping**, as the import's existing mapping through its own save path ([06](../../../wayfinding/the-form-started-from-a-csv/issues/06-one-answer-two-uses.md)): targets for every mapped column, the whole header row (left-out columns included), and every value fix, among them each grid column's bracket text to the market date the year made of it.

It is refused, and writes nothing, if the market has left draft or its form has gained custom fields since the proposal was made.

The seam this closes is the proposal and the import meeting: the first import of a later export opens with every column restored and every value matched; a question added to the Google Form since shows as new, a reworded header as a saved target missing, as the import does today; a key edited or a question deleted in the builder leaves that column unmapped, with no tracking.

**Decided while building (2026-09-27):** the file is sent again with the confirm and never stored, so the server reads the columns itself rather than trusting the browser's copy.
The form, the plan and the mapping are one conditioned update; the form and plan writes were split into `prepared_application_form` and `prepared_plan` so their judgements stay stated once.
A value fewer than 3 applicants gave, which the proposal never made part of the plan or the form (a `TEST` row's tier), is saved as ignored, so the first import asks nothing; the same fate as a rare option the organizer did not keep.
Only the rankings can be declared not asked, so those are the essential questions confirm marks not asked.
The import's own rail did not count a per-date tier grid as answering availability, as its server always did; fixed here, since the seam test met it.

## Acceptance criteria

- [x] After confirm on a fixture, the market reads back with the proposed plan facts, form, ceiling and mapping, and the Application Form tab shows the questions in file order.
- [x] A confirm that fails part-way leaves nothing written.
- [x] A plan that already had tiers keeps them; the file's disagreements are value fixes in the mapping, not plan changes.
- [x] Playwright, the seam end to end: start from a fixture, confirm, open applications, import the same fixture, and find no column to map and no value to match.
- [x] The import's restore skips a saved target whose key is no longer on the form, showing that column as needing a mapping.
- [x] AGENTS.md records the sharp edge: the proposal writes the import's own mapping, and there is one mapping format.
