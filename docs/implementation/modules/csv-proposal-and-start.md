---
layer: implementation
kind: module
describes:
  - back-end/csv_proposal.py
  - back-end/csv_start.py
  - back-end/app.py#csv_proposal_typesafe
  - back-end/app.py#propose_from_csv
  - back-end/app.py#confirm_csv_proposal
  - back-end/tests/test_csv_proposal.py
verified: 2026-10-22
sources:
  - wayfinding/the-form-started-from-a-csv/03
  - wayfinding/the-form-started-from-a-csv/05
  - E24
  - E24/F02/S01
  - E24/F03/S03
  - E33/F02/S01
---

# The CSV proposal and start

A draft can be started from its Google Form's responses (E24).
[`back-end/csv_proposal.py`](../../../back-end/csv_proposal.py) reads the file into a **proposal** of what every column becomes and writes nothing; [`back-end/csv_start.py`](../../../back-end/csv_start.py) writes what the organizer confirmed, in one update or not at all.

## Its interface

Three endpoints in [`back-end/app.py`](../../../back-end/app.py), the two that touch a market ADMIN and refusing an archived one, as the import they prepare does:

| Endpoint | What it does |
| --- | --- |
| `GET /csv-proposal/typesafe` | whether hosted TypeSafe is configured, so the upload step can say so before anything is sent |
| `POST /markets/:id/csv-proposal` | the proposal for this market and this file (`propose`), or why there is none; writes nothing and keeps nothing |
| `POST /markets/:id/csv-proposal/confirm` | the organizer's choices written: the plan facts, the form, the ceiling and the import mapping (`confirm`), or nothing |

The proposal says, for each column in the file's order, its fate (who applied, when, an essential question, a question of the organizer's own with its type, options, label, help text and key, or left out, and why) and what is worth a second look; and for the plan, the file's dates and the year they fit, its tiers best first, the ceiling on days per vendor a heading states, and where those disagree with a plan already there.

## Sharp edges

**Only a draft whose form has no questions of its own** (`refusal`): the plan and the form it writes are a draft's to change, and the proposal never has to merge with questions already written.

**The proposal writes nothing; confirm writes in ONE conditioned update, or nothing.**
Confirm judges the plan and the form through the plan's and the form's own writes (`prepared_plan`, `prepared_application_form`, so [the form lock](../../business/rules/the-form-locks-at-the-first-application.md) above all), then writes them as one `$set` filtered on the market as it was read: its phase as stored and its form still without questions (`still_startable`).
A market that changed since is written nothing, and told to start again.
**The plan's own values win**: the file's dates (in the year the organizer confirms) and tiers fill a plan that has none, and its ceiling a plan with none set.

**The file is sent twice and stored never.**
Confirm reads it again rather than trusting the browser's copy of the columns, and re-runs the rules on it; the organizer's choices for each ledger row are the only thing the request adds, and the browser sends one for every row, so what TypeSafe settled reaches confirm as the organizer's choice, never by asking again.

**The proposal writes the import's own mapping, and there is one mapping format** (`csv_import.mapping_payload`, saved `madeBy: start`).
The first import of a later export restores every column and matches every value ([the CSV import](csv-import.md)).
A value the proposal never offered (fewer than 3 applicants gave it, such as a test row's "TEST"), or a rare option the organizer did not keep, is saved as ignored, so the import does not ask again; a day or tier the plan lacks that the organizer did not settle is left for the import to ask.
Do not give the proposal a mapping shape of its own.

**The rules read values, never header words**, except the words Google itself writes (`Timestamp`) and the review columns organizers add beside a form ("Status", "Notes"): header wording is what the next organizer changes, and value rules survived that where keyword rules did not.
A column is read through the privacy view, answers at least 3 applicants gave (`SHARED_BY`, counted by applicant address and, for a multi-select, per option), and otherwise a shape; every option of a choice question, with its count, comes from the whole file, which never leaves the server.
Hosted TypeSafe settles the two judgements the rules leave, when a key is set ([ADR 0007](../../adr/0007-what-may-be-sent-to-hosted-typesafe.md)).

**The proposal marks no question required** ([no question is inferred required](../../business/rules/no-question-is-inferred-required.md)).

**The rules are held to the hand-written answer key on the five anonymised exports** ([`back-end/tests/test_csv_proposal.py`](../../../back-end/tests/test_csv_proposal.py), over [the Google Form corpus](../../../back-end/tests/test_data/README.md)): every column's kind, and every own question's type and options, written before any rule existed.
Change a rule against that, not beside it; `test_csv_proposal_plan.py` does the same for the plan, and `test_csv_start.py` pins confirm.

## Why

- [No question is inferred required](../../business/rules/no-question-is-inferred-required.md).
- [The form locks at the first application](../../business/rules/the-form-locks-at-the-first-application.md): confirm is one of the form's two writers, through the same judgement.

[ADR 0007](../../adr/0007-what-may-be-sent-to-hosted-typesafe.md) records what may leave the server.

The organizer's side of it, from the upload to confirm or cancel, is [starting from a Google Form's responses](../../business/flows/starting-from-a-google-form.md).
