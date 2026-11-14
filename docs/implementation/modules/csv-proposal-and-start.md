---
layer: implementation
kind: module
describes:
  - back-end/csv_proposal.py
  - back-end/csv_start.py
  - back-end/app.py#csv_proposal_typesafe
  - back-end/app.py#propose_from_csv
  - back-end/app.py#confirm_csv_proposal
  - back-end/api/markets.py#leave_out_every_answer
  - back-end/tests/test_csv_proposal.py
  - front-end/src/utils/exampleColumns.ts
verified: 2026-11-14
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
  - E38/F15/S02
  - T213
  - bug/40
  - T263
  - T274
---

# The CSV proposal and start

A draft can be started from its Google Form's responses (E24).
[`back-end/csv_proposal.py`](../../../back-end/csv_proposal.py) reads the file into a **proposal** of what every column becomes and writes nothing; [`back-end/csv_start.py`](../../../back-end/csv_start.py) writes what the organizer confirmed, in one update or not at all.

## Its interface

Three endpoints in [`back-end/app.py`](../../../back-end/app.py), the two that touch a market asking the import's row (Admin by default, through `_importing_market_document`) and refusing an archived one, as the import they prepare does; confirm asks the Assign row too when its plan changes the market's assignment rules, as the plan write does:

| Endpoint                                 | What it does                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /csv-proposal/typesafe`             | whether hosted TypeSafe is configured, so the upload step can say so before anything is sent                                                      |
| `POST /markets/:id/csv-proposal`         | the proposal for this market and this file (`propose`), or why there is none; writes nothing and keeps nothing                                    |
| `POST /markets/:id/csv-proposal/confirm` | the organizer's choices written: the plan facts, the form, the ceiling, the import mapping and the example file's columns (`confirm`), or nothing |

The proposal says, for each column in the file's order, its fate (who applied, when, an essential question, a question of the organizer's own with its type, options, label, help text and key, or left out, and why) and what is worth a second look; and for the plan, the file's dates and the year they fit, its tiers best first, the ceiling on days per vendor a heading states, and where those disagree with a plan already there.
A file never states locations, sections or table counts, so the proposal never offers them, and it proposes no priority rule: what ranks vendors is the organizer's judgement, which the file does not hold.
An essential question no column answers is proposed as not asked, which is what the import would otherwise refuse on.

## Sharp edges

**The start reads a file as the import does** (E38/F15/S02): the browser's `readCsvFile` and the server's `parse_csv` are the import's own, so a file that is not a CSV export stops on the Upload step with the import's words ([the CSV import](csv-import.md#sharp-edges)).

**A response is a row someone submitted** (`_is_response`): one with three answered cells, or every cell in a file narrower than three columns, since a Google Form with one question exports its Timestamp and that question, and every submission fills both.
An organizer's status typed into an empty row is one cell, and is no response in a file at least two columns wide (bug 40).
Every column's "answered by N of M", its first answers and the share of the responses that answered it (which decides who applied, a team's verdict column and which questions nearly everyone answered, and is the share hosted TypeSafe is sent, never over 100%) are read from those rows alone, so a first answer never stands beside "answered by 0 of 0" (E38/F15/S02).

**Only a draft whose form has no questions of its own** (`refusal`): the plan and the form it writes are a draft's to change, and the proposal never has to merge with questions already written.

**The proposal writes nothing; confirm writes in ONE conditioned update, or nothing.**
A request confirm cannot write is a `ConfirmRefused`, a 409 [client error](../conventions/an-exception-never-reaches-a-client.md) saying why.
`confirm` catches nothing: a `ConfirmRefused`, a locked form (409), a plan or a form its writers refuse (400), the Assign row's refusal (403) and a market that changed (`MarketChanged`, 409) reach the handler as raised, and none of the three routes catches anything.
Confirm judges the plan and the form through the plan's and the form's own writes (`prepared_plan`, whose parsed plan and `$set` it takes, and `prepared_application_form`, so [the form lock](../../business/rules/the-form-locks-at-the-first-application.md) above all), then writes them as one `$set` through [the market write](market-write.md), holding the market's phase and its `applicationForm` as it was read, which the start judged had no questions of its own: a form that gained one since, or another start, refuses it whole with the one 409 and [its sentence](market-write.md#what-it-answers), which the start's page shows on its review step.
The same write counts the form's revision, since it writes the questions and no page sent one, so a form tab read before the start is told the market changed rather than saving its copy over them ([the form's revision](market-write.md#the-forms-revision)).
It writes the plan too, built on the plan as read, so it holds the plan's revision at its value as read and counts it: a plan saved while the start read its file refuses the start, and a Market Setup page read before the start is told the market changed ([the plan's revision](market-write.md#the-plans-revision)).
A layout whose location the start's plan no longer has goes as it does from a plan write: once the write lands, `release_removed_floorplans` deletes its image and records `floorplan_removed` ([a location's layout](floorplan-placement.md#sharp-edges)).
**A start whose rules differ from the market's asks the Assign row** (`ask_assign_if_the_rules_change`, the plan write's own check, [the market's actions](market-actions.md#each-routes-row)): the rules ride in the plan, and a ceiling the start fills sets a vendor's most tables, so someone the import's row lets in and the Assign row refuses is refused (403) and nothing is written.
A market with no setup yet holds the rules a new plan starts with, so a start that sets no ceiling and keeps the plan's rules asks only the import's row; the organization asked is the one `_importing_market_document` read.
The proposal asks only the import's row, since it writes nothing.
**The plan's own values win**: the file's dates (in the year the organizer confirms) and tiers fill a plan that has none, and its ceiling a plan with none set.

**The file is sent twice and stored never; what the start keeps of it is filtered.**
Confirm reads it again rather than trusting the browser's copy of the columns, and re-runs the rules on it; the organizer's choices for each ledger row are the only thing the request adds, and the browser sends one for every row, so what TypeSafe settled reaches confirm as the organizer's choice, never by asking again.

**The start keeps what the file said of each question of the organizer's own and each left-out column** (`exampleColumns`, E38/F02/S01), so the Questions tab can fill a question's options, or add a question from a left-out column, after the file is gone ([building the application form](../../business/flows/form-tab.md#f2-custom-questions), [`exampleColumns.ts`](../../../front-end/src/utils/exampleColumns.ts)).
For each ledger row the organizer confirmed as a question of their own or left out, and that had answers, it keeps the headings, the key its question has or would have, the label and help text, the type written or read, whether it became a question, and both readings of its answers as choices (`kept_readings`): whole answers for Select, the options inside them for Multi-Select.
A reading keeps only the options the Review step keeps by default, those at least 3 applicants chose (`SHARED_BY`, and for a multi-select at least `OPTION_SHARE` of the answers), less any that names someone (`_names_someone`); values only, most chosen first.
`_names_someone` finds an address, also spelled out ("info AT example DOT com", "info[at]example[dot]com"); a link with or without its scheme ("linktr.ee/makers"); a handle wherever its `@` sits ("IG:@makers", "@ makers"); every phone number the measured filter finds, and one of 7 digits, unless its digits are only clock times, years and dates of a day, a month and a year ("9.30 - 4.30", "2023 - 2024", "15.11.2025"), or a range of numbers around a dash, two of 3 to 5 digits and 9 at most together, the lower first, each end within one of round ("500-1000", "501-1000", "100-1499"); and a street address (ordinal streets and the usual abbreviations), a unit, suite or apartment number, or a post office box.
In these readings, what no pattern sees only `SHARED_BY` guards, such as a bare name, a shop's name, a handle without its `@` or with a full-width `＠`, a domain with its dot spelled, bracketed or a comma ("example dot com", "makers[.]ca", "example,com"), an address with no top-level domain ("makers@gmail", "makers@"), a domain in another script, a postal code, a unit by letter or a room ("Unit B", "Room 101"), a street with no street word ("42 Broadway"), a box with no "PO" ("Box 45"), a number spelled in words, a phone number grouped oddly ("555 01 99"), and a round local number that reads as a range ("200-3000"); `test_csv_proposal.py` pins what it catches and what it leaves.
[ADR 0018](../../adr/0018-what-of-an-applicants-answers-the-market-may-keep.md) records the decision; that is safe to keep for the reason it was safe to read: an answer 3 applicants share names none of them, which is the uniqueness rule [ADR 0007](../../adr/0007-what-may-be-sent-to-hosted-typesafe.md) measured, and the headings are the organizer's own words, which the import mapping already keeps.
These readings leave the server only to everyone who may read the market, a Viewer and up, organization members included, on the market's read and the Markets list; each of them already reads every application.
It is server-owned: the start writes it, and a create body that carries it, or an import mapping, is stored without either (`create_market`).
Who applied, when and the essential questions are not kept: none is a question to add or retype.
A later import does not refresh it: the form locks at the first application, so it is never read after one.

**The start also keeps every answer of a column, for an option on the Questions tab to offer** (`answers`, [ADR 0023](../../adr/0023-every-answer-for-an-option-to-offer.md), T213).
`every_reading` holds both readings, each less what `_names_someone` catches, values only, most chosen first, so it is a superset of `kept_readings`, which it leaves as it was.
A column whose answers are mostly different returns nothing and is written with no `answers` key: its Select reading holds at least `MOSTLY_DIFFERENT` (70%) as many answers as applicants who answered, and at least `MOSTLY_DIFFERENT_FROM` (20) answered, which keeps whole columns of Discord usernames, shop names and free text off the market; [ADR 0023](../../adr/0023-every-answer-for-an-option-to-offer.md) says what the line was measured on, and the two cases that pass it, a small file and repeated words.
Elsewhere no share of applicants guards it, so what no pattern sees, such as a bare name or a shop's name typed into a choice column, is kept.
No `answers` on a column always means its common options are all there is: a market started before this has none, and no migration adds them.
[`exampleColumns.ts`](../../../front-end/src/utils/exampleColumns.ts) reads them: `fileAnswers` is the type's `answers` reading, or `fileOptions` with no `answers`, and `answersToOffer` is that less every other option on the question, for `FormFieldEditor` to list; `fileOptions`, the common ones, stays what a type change, "Use the answers in your file" and "Add from your file" fill.
The market read serves `answers` only to a role that passes `CHANGE_FORM` on the market's table, while `application_form_lock_reason` is `None`.
Everything else that answers with a market removes it through `leave_out_every_answer` in [`back-end/api/markets.py`](../../../back-end/api/markets.py): the read for anyone else, the Markets list, and the two assignment responses that dump the whole market (`get_assigned_market`, `run_assignment`).
They stay stored after the form locks, unread, and go when the market is deleted; a later change to an application does not change them, and there is no way to remove one answer from them.
On the five synthetic exports they add 11 KB to 19 KB to a market, beside about 2 KB of common readings.

**A left-out column is saved in the mapping under the key a question made from it would have.**
A key the mapping already holds is never replaced by one.
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
The key is the label's slug, cut to 40 characters on a word boundary, with `_2` and on for a repeat (`key_for`); the import's own targets (`RESERVED_TARGETS`: who applied, when, the sheet's note) count as taken, so a column called "Applicant email" is `applicant_email_2`.
Renaming a question in the form builder keeps its key, so the mapping survives; an edited key or a deleted question leaves a saved target the import's restore skips, and that column asks for a mapping like a new one, because a whole-form save cannot tell a rename from a delete and an add.

**The rules read values, never header words**, except the words Google itself writes (`Timestamp`) and the review columns organizers add beside a form ("Status", "Notes"): header wording is what the next organizer changes, and value rules survived that where keyword rules did not.
A column is read through the privacy view, answers at least 3 applicants gave (`SHARED_BY`, counted by applicant address and, for a multi-select, per option) that hold no address, link, handle or phone number (`_identifying`), and otherwise a shape; every option of a choice question, with its count, comes from the whole file, which never leaves the server.
**The rules read through the filter the answer key was measured with, and what is kept or sent through the wider one**: `_identifying` builds the privacy view the classification reads, and `_names_someone` guards what the start keeps and, beside it, which headings may be sent; the answer key was measured on the narrow one, and a wider view changes what the rules propose (an earlier draft of the wider one took "500-1000" out of a question answered with ranges, which then read as Text).
Hosted TypeSafe settles the two judgements the rules leave, when a key is set ([ADR 0007](../../adr/0007-what-may-be-sent-to-hosted-typesafe.md)).

**The proposal marks no question required** ([no question is inferred required](../../business/rules/no-question-is-inferred-required.md)).
A choice nearly everyone gave is a checkbox only when no other answer the privacy view holds is anything but an unticked word (`_a_choice_nearly_everyone_gave`, over the import's own `UNTICKED`), so a team's "Review" column of "Accepted" and a few "Rejected", added back with "Add from your file", is a Select of both, which the import stores as each row's verdict rather than all ticked ([the same rule](../../business/rules/no-question-is-inferred-required.md#where-it-is-kept)).

**The rules are held to the hand-written answer key on the five corpus exports** ([`back-end/tests/test_csv_proposal.py`](../../../back-end/tests/test_csv_proposal.py), over [the Google Form corpus](../../../back-end/tests/test_data/README.md)): every column's kind, and every own question's type and options, written before any rule existed.
Change a rule against that, not beside it; `test_csv_proposal_plan.py` does the same for the plan, and `test_csv_start.py` pins confirm.

**The start records one entry in [the market's history](../data/history.md)**, `started` with its row, column and question counts rather than the plan and the form it wrote whole; the proposal keeps nothing and records nothing.

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
