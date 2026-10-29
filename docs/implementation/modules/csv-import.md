---
layer: implementation
kind: module
describes:
  - back-end/csv_import.py
  - back-end/app.py#_importing_market_document
  - back-end/app.py#_import_context
  - back-end/app.py#inspect_application_import
  - back-end/app.py#preview_application_import
  - back-end/app.py#import_applications
verified: 2026-10-29
sources:
  - wayfinding/readable-journey/05
  - wayfinding/v0-1-0/map
  - wayfinding/v0-1-0/04
  - wayfinding/v0-1-0/05
  - E01
  - E24/F03/S03
  - E31/F03/S04
  - bug/5
  - bug/34
  - bug/42
  - bug/27
  - E33/F03/S02
  - E38/F04/S01
---

# The CSV import

[`back-end/csv_import.py`](../../../back-end/csv_import.py) turns the responses CSV of an organizer's own Google Form into applications.
The form is not the product's, so nothing is matched by header name: the organizer maps each column to the question it answers, and every row is written as the same `Application` the public form produces.

## Its interface

Three endpoints in [`back-end/app.py`](../../../back-end/app.py), each asking the table's import row (Admin by default) and each through `_import_context`:

| Endpoint | What it does |
| --- | --- |
| `POST /markets/:id/applications/import/inspect` | the file's headers, a few sample values, the targets a column can map to, a suggested mapping, and the previous import's mapping restored onto this file (`inspect`); writes nothing |
| `POST .../import/preview` | every cell value that names nothing the market offers, once per distinct value with how many rows it affects, and the rows that would be refused (`preview_values`); writes nothing |
| `POST .../import` | the rows written as applications awaiting review, the mapping saved, and a count of what was created, updated, unchanged, skipped, repeated and sent back to review (`import_applications`) |

## Sharp edges

**Importing is the CSV path's, in Draft and Review** (E31/F03/S04).
`import_refusal` refuses a form market outright, and otherwise allows `draft` and `applications` (`IMPORT_PHASES`): a draft's first import is its way into Review, and in Review a Redo import reads the whole file again (E38/F04, [review needs an import](../../business/rules/review-needs-an-import.md)); past review, nothing more can be imported, since no move leads back (bug 42).
In a draft it also refuses with the first of `first_import_blockers`, the move into Review judged less `ResponsesImportedGuard`, so a setup that would keep the market out is said before a row is read.

**The first import takes the market into Review** once its rows are written: `enter_review` moves it through `take_move` under the importer, and the result says the phase it is in (`phase`).
A first import that wrote nothing, or a move refused by a setup changed under it, leaves the market a draft.
`_import_context` asks it on every endpoint, so a hidden button is never the rule; `_importing_market_document` asks the row Import applications, and start a market from a CSV ([the market's actions](market-actions.md)) and refuses an archived market first.
The three endpoints catch nothing: their refusals are the literal answers above, and anything else is the generic 500 ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md)).

**Every row goes through `record_application_answers(imported=True)`**, the applicant's own write ([`back-end/application_write.py`](../../../back-end/application_write.py)), so an imported application and a submitted one are the same kind of thing by construction; `imported=True` is the import's only difference ([what an import may leave unasked](../../business/rules/what-an-import-may-leave-unasked.md)).

**An address is taken as written, never proven.**
The column mapped to `APPLICANT_EMAIL_TARGET` is lowercased and trimmed, and `_EMAIL_ADDRESS` refuses only what is plainly not an address, deliberately loose; nothing confirms that the vendor controls it, and the application records no difference from one proven by a sign-in code ([an imported email is asserted](../../business/rules/an-imported-email-is-asserted.md)).

**It refuses at the mapping and tolerates at the row.**
An unmapped required target imports nothing, and neither does an unsettled value; one malformed row does not stop the others, and every skipped row is named in the result, since an import that looks complete with a vendor silently missing is the worst outcome.
Every refusal is decided before anything is written: creating first and validating after left an empty application behind for every row the preview had promised to skip (bug 5).

**One row per applicant.**
A Google Form keeps every submission, so a vendor who applied twice is two rows; they are one application, judged on the latest row and dated by the first (`_latest_rows`), and the earlier rows are reported as repeats (bug 34).
A re-import updates each applicant's main application by the market and the address, writes nothing for an unchanged applicant, returns an approved one to review only when their answers, normalised, changed something the solver reads, and leaves an application absent from the file exactly as it is ([ADR 0011](../../adr/0011-re-import-upserts-on-market-and-email.md)).

**`submitted_at` is the form's own timestamp**, an ordinary mapping target, optional, and auto-detected from Google Forms' "Timestamp" heading; it is normalised to ISO 8601 at the boundary (`normalized_submitted_at`, [the application document](../data/application-document.md#the-fields-that-matter)).
A row without one gets the import's moment, so the screen warns when the market orders by arrival and nothing maps it (`orders_by_submitted_at`, [priority and tie-breaks](../../business/rules/priority-and-tie-breaks.md)); the warning, not a refusal, because a market with no rule on arrival does not need the column.

**Values are matched forgivingly, once.**
Surrounding space and capitals match silently; anything else is shown once per distinct value and settled by hand, and those settlements (`resolutions`) are saved with the mapping.
One question may be one column or, for a Google Forms checkbox grid, one column per option; both import to the same stored answer.
Values are offered and compared in the organizer's words, never the stored ones: a date reads as a date, and a table choice as its label rather than its code.

**A grid is never split; one column is split where the comma is not inside an option.**
A grid carries its option in each column's heading, so a cell is never cut up; a checkbox question in one column holds its chosen options joined by commas, and an option may hold a comma of its own.
`split_options` takes every known option (what the question offers, and every value already matched) whole wherever its pieces appear, the longest first, comparing whole pieces only, so "Gold" never matches inside "Gold Plus"; otherwise a comma inside parentheses, or after a weekday that a day of the month follows, belongs to the option (bug 27).
What no reader can settle is an option made of others ("Prints, Cards" offered beside "Prints" and "Cards"): `comma_bearing_targets` names such targets, and the mapping step warns when one column is mapped to one ("One column cannot answer … reliably"), since Google threw away which commas separated answers.
It warns and does not refuse: any value still unmatched must be settled by hand before the preview, so nothing wrong is imported either way, and refusing would strand an organizer whose only copy of the answers is that file; their real fixes are a grid, or renamed options.

**There is one mapping format**, `mapping_payload`: targets by header TEXT, never position, with the file's headers, the resolutions, when, and who made it (`madeBy`: the import, or the start from a CSV).
The import saves it on the market's `importMapping` after every import (`save_mapping`), and the next `inspect` restores it with `restore_mapping`; a target whose headers are not all present is reported as missing rather than half-restored, because a partly mapped grid looks answered.
The start from a CSV writes the same format, so the first import of a later export opens with every column restored and every value matched ([the CSV proposal and start](csv-proposal-and-start.md)); do not give anything a mapping shape of its own.

**After the writes, the [automatic rejection](../../business/rules/automatic-rejections.md) rules judge** what the import wrote and anything else undecided, and the result counts how many they rejected (`rejectedByRules`); and an organizer's own column mapped to "From your sheet" replaces each imported vendor's sheet note ([vendor notes](vendor-notes.md)).

## Superseded

- Matching answers against the offering before splitting a column was rejected, for a warning alone (wayfinding/readable-journey/05); since a split cut options with commas in half, known options are taken whole first, comparing whole pieces so one name inside another never matches, and the warning is left for an option made of others (bug/27).

## Why

- [Intake mode decides how vendors arrive](../../business/rules/intake-mode-decides-how-vendors-arrive.md): importing is the CSV path's way in, refused on a form market.
- [What an import may leave unasked](../../business/rules/what-an-import-may-leave-unasked.md): the one answer an imported row may leave out.
- [An imported email is asserted](../../business/rules/an-imported-email-is-asserted.md): the file's address is the organizer's word, which must be settled before any mail but a sign-in code.
- [Priority and tie-breaks](../../business/rules/priority-and-tie-breaks.md): a row must carry its own `submitted_at` for first come, first served to decide anything.
- [A re-import upserts on the market and the address](../../adr/0011-re-import-upserts-on-market-and-email.md).

`back-end/tests/test_csv_import.py`, `front-end/e2e/csv-import.spec.ts` and `front-end/e2e/the-import-lines-up.spec.ts` pin it; the real exports it is held to are [the Google Form corpus](../../../back-end/tests/test_data/README.md).

What the organizer does on the import, step by step, is [importing a Google Form's responses](../../business/flows/import.md).

The glossary concepts it serves: [Intake mode](../../business/concepts/intake-mode.md) and [Application](../../business/concepts/application.md).
