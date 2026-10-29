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
  - front-end/src/utils/exampleColumns.ts
verified: 2026-10-29
sources:
  - wayfinding/the-form-started-from-a-csv/03
  - wayfinding/the-form-started-from-a-csv/05
  - wayfinding/the-form-started-from-a-csv/06
  - wayfinding/the-form-started-from-a-csv/map
  - E24
  - E24/F02/S01
  - E24/F03/S03
  - E33/F02/S01
  - E38/F02/S01
  - E38/F02/S02
---

# The CSV proposal and start

A draft can be started from its Google Form's responses (E24).
[`back-end/csv_proposal.py`](../../../back-end/csv_proposal.py) reads the file into a **proposal** of what every column becomes and writes nothing; [`back-end/csv_start.py`](../../../back-end/csv_start.py) writes what the organizer confirmed, in one update or not at all.

## Its interface

Three endpoints in [`back-end/app.py`](../../../back-end/app.py), the two that touch a market asking the import's row (Admin by default, through `_importing_market_document`) and refusing an archived one, as the import they prepare does:

| Endpoint | What it does |
| --- | --- |
| `GET /csv-proposal/typesafe` | whether hosted TypeSafe is configured, so the upload step can say so before anything is sent |
| `POST /markets/:id/csv-proposal` | the proposal for this market and this file (`propose`), or why there is none; writes nothing and keeps nothing |
| `POST /markets/:id/csv-proposal/confirm` | the organizer's choices written: the plan facts, the form, the ceiling, the import mapping and the example file's columns (`confirm`), or nothing |

The proposal says, for each column in the file's order, its fate (who applied, when, an essential question, a question of the organizer's own with its type, options, label, help text and key, or left out, and why) and what is worth a second look; and for the plan, the file's dates and the year they fit, its tiers best first, the ceiling on days per vendor a heading states, and where those disagree with a plan already there.
A file never states locations, sections or table counts, so the proposal never offers them, and it proposes no priority rule: what ranks vendors is the organizer's judgement, which the file does not hold.
An essential question no column answers is proposed as not asked, which is what the import would otherwise refuse on.

## Sharp edges

**Only a draft whose form has no questions of its own** (`refusal`): the plan and the form it writes are a draft's to change, and the proposal never has to merge with questions already written.

**The proposal writes nothing; confirm writes in ONE conditioned update, or nothing.**
A request confirm cannot write is a `ConfirmRefused`, a 409 [client error](../conventions/an-exception-never-reaches-a-client.md) saying why.
`confirm` catches nothing: a `ConfirmRefused`, a locked form (409) and a plan or a form its writers refuse (400) reach the handler as raised, and none of the three routes catches anything.
Confirm judges the plan and the form through the plan's and the form's own writes (`prepared_plan`, `prepared_application_form`, so [the form lock](../../business/rules/the-form-locks-at-the-first-application.md) above all), then writes them as one `$set` filtered on the market as it was read: its phase as stored and its form still without questions (`still_startable`).
A market that changed since is written nothing, and told to start again.
**The plan's own values win**: the file's dates (in the year the organizer confirms) and tiers fill a plan that has none, and its ceiling a plan with none set.

**The file is sent twice and stored never; what the start keeps of it is the privacy view.**
Confirm reads it again rather than trusting the browser's copy of the columns, and re-runs the rules on it; the organizer's choices for each ledger row are the only thing the request adds, and the browser sends one for every row, so what TypeSafe settled reaches confirm as the organizer's choice, never by asking again.

**The start keeps what the file said of each question of the organizer's own and each left-out column** (`exampleColumns`, E38/F02/S01), so the Questions tab can fill a question's options, or add a question from a left-out column, after the file is gone ([building the application form](../../business/flows/form-tab.md#f2-custom-questions), [`exampleColumns.ts`](../../../front-end/src/utils/exampleColumns.ts)).
For each ledger row the organizer confirmed as a question of their own or left out, and that had answers, it keeps the headings, the key its question has or would have, the label and help text, the type written or read, whether it became a question, and both readings of its answers as choices (`kept_readings`): whole answers for Select, the options inside them for Multi-Select.
A reading keeps only the options the Review step keeps by default, those at least 3 applicants chose (`SHARED_BY`, and for a multi-select at least `OPTION_SHARE` of the answers), less any holding an address, link, handle or phone number (`_identifying`); values only, most chosen first.
That is safe to keep for the reason it was safe to read: an answer 3 applicants share names none of them, which is the uniqueness rule [ADR 0007](../../adr/0007-what-may-be-sent-to-hosted-typesafe.md) measured, and the headings are the organizer's own words, which the import mapping already keeps.
Nothing kept leaves the server but to the market's own readers, who see the applications themselves.
Who applied, when and the essential questions are not kept: none is a question to add or retype.
A later import does not refresh it: the form locks at the first application, so it is never read after one.

**A left-out column is saved in the mapping under the key a question made from it would have.**
The import restores only the targets the form has, so that target waits unread until the organizer adds the question from the Questions tab, and the first import then restores it with the rest; a question added by hand under the same key is restored to that column too.

**The proposal writes the import's own mapping, and there is one mapping format** (`csv_import.mapping_payload`, saved `madeBy: start`).
The first import of a later export restores every column and matches every value ([the CSV import](csv-import.md)).
A value the proposal never offered (fewer than 3 applicants gave it, such as a test row's "TEST"), or a rare option the organizer did not keep, is saved as ignored, so the import does not ask again; a day or tier the plan lacks that the organizer did not settle is left for the import to ask.
Do not give the proposal a mapping shape of its own.
The tier grid's bracket texts ("Monday, November 17") are saved as value fixes too, each to the market date the confirmed year makes of it, so the import never asks which date a column is.

**A later file that differs is the import's to handle, as any file is.**
A question added to the Google Form afterwards is new since the last import and reaches the form through [the form amendment](form-amendment.md); a reworded heading is a saved target reported missing and mapped by hand.
No heading is matched loosely: only its spacing and line breaks are ignored (`collapse_header`).

**The questions keep the Google Form's words; the product writes none.**
A heading's first line is the label and everything after its first line break is help text (`label_and_help`); a first line over 120 characters keeps its first sentence as the label and moves the rest into help text, and one with no sentence end stays whole, since a long label reads fine and a broken one does not (bug 41).
The key is the label's slug, cut to 40 characters on a word boundary, with `_2` and on for a repeat (`key_for`).
Renaming a question in the form builder keeps its key, so the mapping survives; an edited key or a deleted question leaves a saved target the import's restore skips, and that column asks for a mapping like a new one, because a whole-form save cannot tell a rename from a delete and an add.

**The rules read values, never header words**, except the words Google itself writes (`Timestamp`) and the review columns organizers add beside a form ("Status", "Notes"): header wording is what the next organizer changes, and value rules survived that where keyword rules did not.
A column is read through the privacy view, answers at least 3 applicants gave (`SHARED_BY`, counted by applicant address and, for a multi-select, per option) that hold no address, link, handle or phone number (`_identifying`), and otherwise a shape; every option of a choice question, with its count, comes from the whole file, which never leaves the server.
Hosted TypeSafe settles the two judgements the rules leave, when a key is set ([ADR 0007](../../adr/0007-what-may-be-sent-to-hosted-typesafe.md)).

**The proposal marks no question required** ([no question is inferred required](../../business/rules/no-question-is-inferred-required.md)).

**The rules are held to the hand-written answer key on the five anonymised exports** ([`back-end/tests/test_csv_proposal.py`](../../../back-end/tests/test_csv_proposal.py), over [the Google Form corpus](../../../back-end/tests/test_data/README.md)): every column's kind, and every own question's type and options, written before any rule existed.
Change a rule against that, not beside it; `test_csv_proposal_plan.py` does the same for the plan, and `test_csv_start.py` pins confirm.

## Evidence

The rules alone were scored against an answer key written by hand before them, on 135 columns of the five exports: every column's kind right, 72 of 74 own questions' types, options at a precision of 1.00 and a recall of 0.98, and every file's dates, tiers and ceiling, so a file needs about one correction.
Reading a column through the privacy view cost nothing and helped: the whole column read free text holding commas as a multi-select and a `TEST` row as a tier.
A first draft that matched header keywords scored the same on the corpus and failed on other organizers' wordings (full name 3 of 9, email 2 of 7, table-share partner 0 of 4, organizer columns 6 of 15), where the value rules passed all of them.
What the rules still miss is an organizer's notes column placed after the questions, a ceiling in unusual prose (both [TypeSafe's](../../adr/0007-what-may-be-sent-to-hosted-typesafe.md), when a key is set), a choice that allows several answers when almost nobody chose two, and an option fewer than 3 applicants chose; the last two are the organizer's alone, which is why the review shows them.
The weekdays in the dates' headings pin the year in every file, so the year question opens on it.

## Why

- [No question is inferred required](../../business/rules/no-question-is-inferred-required.md).
- [The form locks at the first application](../../business/rules/the-form-locks-at-the-first-application.md): confirm is one of the form's two writers, through the same judgement.

[ADR 0007](../../adr/0007-what-may-be-sent-to-hosted-typesafe.md) records what may leave the server.

The organizer's side of it, from the upload to confirm or cancel, is [starting from a Google Form's responses](../../business/flows/starting-from-a-google-form.md).

The glossary concepts it serves: [Intake mode](../../business/concepts/intake-mode.md) and [Essential question](../../business/concepts/essential-question.md).
