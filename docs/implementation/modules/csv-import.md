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
  - front-end/src/utils/csvFile.ts
  - front-end/src/components/ValueFixes.vue
  - front-end/src/components/csvImport/ImportRefusedRows.vue
  - front-end/src/views/CsvImportView.vue#mapsTo
  - front-end/src/views/CsvImportView.vue#holdsAMapping
verified: 2026-11-13
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
  - E38/F02/S01
  - E41/F01/S01
  - E38/F04/S01
  - E38/F03/S02
  - E38/F06/S01
  - E38/F07/S03
  - E38/F15/S02
  - T205
  - T223
  - T263
  - T270
  - T274
  - T271
  - T315
---

# The CSV import

[`back-end/csv_import.py`](../../../back-end/csv_import.py) turns the responses CSV of an organizer's own Google Form into applications.
The form is not the product's, so nothing is matched by header name: the organizer maps each column to the question it answers, and every row is written as the same `Application` the public form produces.

## Its interface

Three endpoints in [`back-end/app.py`](../../../back-end/app.py), each asking the table's import row (Admin by default) and each through `_import_context`:

| Endpoint                                        | What it does                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /markets/:id/applications/import/inspect` | the file's headers, a few sample values, the targets a column can map to, a suggested mapping, and the previous import's mapping restored onto this file (`inspect`); writes nothing                                                                                                                                                                                               |
| `POST .../import/preview`                       | every cell value that names nothing the market offers, once per distinct value with how many rows it affects, and the rows that would be refused (`preview_values`); once every value is settled, the first rows that will import and no rule rejects (`samples`), and every row the import's judging will newly reject, with the rule and the reason (`rejected`); writes nothing |
| `POST .../import`                               | the rows written as applications awaiting review, the mapping saved, and a count of what was created, updated, unchanged, skipped, repeated and sent back to review (`import_applications`)                                                                                                                                                                                        |

## Sharp edges

**A file that is not a CSV export is refused before it is read** (E38/F15/S02).
A binary named `responses.csv`, read anyway, went on to Map columns as one column headed by garbled characters.
The browser reads every dropped or picked file through `readCsvFile` ([`front-end/src/utils/csvFile.ts`](../../../front-end/src/utils/csvFile.ts)), the import's and the start from a CSV's alike: a file that does not decode as UTF-8, holds a NUL byte, or whose header row holds an unprintable character stops on the upload step with "This file does not look like a CSV export. Download the responses again from Google Forms as .csv." (`NOT_A_CSV_EXPORT`), and nothing is sent.
A CSV that Excel saved in another encoding is refused the same way once it holds an accented letter, since a decode that guesses garbles every accented name.
The server sees text, not bytes, so `parse_csv` refuses a NUL anywhere, or an unprintable character or the replacement character in the header row, with the same words, for every endpoint that reads a file.
The two unprintable sets are one set written twice (`UNPRINTABLE` in the browser, `_UNPRINTABLE_CODES` on the server), and one table of the characters on each side of every bound, line feed and carriage return aside, runs in a header row through both readers, so a bound moved in either fails a test.
The browser's reader drops a byte-order mark, and an empty file goes on to the server's "That file is empty."

**A file too large to send is refused before it is sent** (T315).
The host refuses a request body over 4.5 MB before the back end sees it ([the host's limits](../../OPERATIONS.md#the-hosts-limits)), and an organizer with a large file was told "The import could not be completed." or that they seemed to be offline, and tried again.
`readCsvFile` takes the sentence for a too-large file from its caller and holds the file to `MAX_RESPONSES_FILE_BYTES`, 4,000,000 bytes, the 4 MB the floorplan upload holds, leaving the rest of the 4.5 MB for the request's other fields: a file whose `size` passes it is refused before it is read, and one whose text passes it as the JSON string the request carries, each line break and quote escaped, once read.
The import's sentence is `IMPORT_FILE_TOO_LARGE`, "This file is too large to send: one import carries at most 4 MB. Split its rows into smaller files, each with the header row, and import them one after another.", since a later import leaves the applications an earlier one brought in as they are ([ADR 0011](../../adr/0011-re-import-upserts-on-market-and-email.md)); the start's is `START_FILE_TOO_LARGE` ([starting from a Google Form](../../business/flows/starting-from-a-google-form.md#g3-upload-and-the-year-question)).
A body that passes the back end's own 4.5 MB anyway is answered 413 with a sentence ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md#the-handlers)).
Production's host answers its own 413, before the back end runs, with none of the back end's CORS headers, so the browser hides it and it reaches the page as a failed connection, "You seem to be offline"; the app's API client refuses any body over 4.5 MB before it is sent, with "This was larger than the 4.5 MB one request can carry." ([what the organizer reads](../conventions/an-exception-never-reaches-a-client.md#what-the-organizer-reads)).

**Importing is the CSV path's, in Draft and Review** (E31/F03/S04).
`import_refusal` refuses a form market outright, and otherwise allows `draft` and `applications` (`IMPORT_PHASES`): a draft's first import is its way into Review, and in Review a Redo import reads the whole file again (E38/F04, [review needs an import](../../business/rules/review-needs-an-import.md)); past review, nothing more can be imported, since no move leads back (bug 42).
In a draft it also refuses with every one of `first_import_blockers`, the move into Review judged less `ResponsesImportedGuard`, their messages joined in the guards' order, so all a setup lacks to let the market in is said at once, before a row is read (T205: one trip to Market Setup, not one per missing thing).
`firstImportBlockers` and `importRefusal` in [`front-end/src/utils/importPhase.ts`](../../../front-end/src/utils/importPhase.ts) are their mirrors, read from the served `transitionBlockers` and the market's intake, so the import's page and a refused request say the same: the form market's sentence before anything else, and otherwise the same list.
The page's refusal heading (`refusalHeading` in `CsvImportView.vue`) checks the phase before the role: an archived market is headed "An archived market takes no imports" whoever reads it, since the served `actionRefusals` put the archived sentence before each changing row's own, so it reaches the page as the role refusal, the Owner's included; the body is that refusal as served (T315).
The page's `h1` (`heading`) reads "Redo import" in Review alone, where the rail offers it, and on the done step of a redo; on a market past review, from Assignment to archived, it is "Import responses", as on a draft's refused first import, never "Redo import", which such a market does not offer.

**The first import takes the market into Review** once its rows are written: `enter_review` moves it through `take_move` under the importer, and the result says the phase it is in (`phase`).
A first import that wrote nothing, or a move refused by a setup changed under it, leaves the market a draft.
`_import_context` asks it on every endpoint, so a hidden button is never the rule; `_importing_market_document` asks the row Import applications, and start a market from a CSV ([the market's actions](market-actions.md)) then refuses an archived market whoever may.
It returns the stored document beside the organization that check read (`ImportingMarket`), so the start from a CSV asks the Assign row of the same organization when its plan changes the assignment rules ([the CSV proposal and start](csv-proposal-and-start.md#sharp-edges)).
The three endpoints catch nothing: their refusals are the literal answers above, the import's 404 "Market not found" when the market began its deletion under it, which takes back what it wrote ([the tombstone](market-deletion.md#the-tombstone)), and anything else is the generic 500 ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md)).

**Every row goes through `record_application_answers(imported=True)`**, the applicant's own write ([`back-end/application_write.py`](../../../back-end/application_write.py)), so an imported application and a submitted one are the same kind of thing by construction; `imported=True` is the import's only difference ([what an import may leave unasked](../../business/rules/what-an-import-may-leave-unasked.md)).

**An address is taken as written, never proven.**
The column mapped to `APPLICANT_EMAIL_TARGET` is lowercased and trimmed, and `_EMAIL_ADDRESS` refuses only what is plainly not an address, deliberately loose; nothing confirms that the vendor controls it, and the application records no difference from one proven by a sign-in code ([an imported email is asserted](../../business/rules/an-imported-email-is-asserted.md)).

**It refuses at the mapping and tolerates at the row.**
An unmapped required target imports nothing, and neither does an unsettled value; one malformed row does not stop the others, and every skipped row is named in the result, since an import that looks complete with a vendor silently missing is the worst outcome.
Every refusal is decided before anything is written: creating first and validating after left an empty application behind for every row the preview had promised to skip (bug 5).

**One row per applicant.**
A Google Form keeps every submission, so a vendor who applied twice is two rows; they are one application, judged on the latest row and dated by the first (`_latest_rows`), and the earlier rows are reported as repeats (bug 34).
A re-import updates each applicant's main application by the market and the address, keeps every organizer's [update of an answer](../../business/rules/an-update-is-kept-beside-the-vendors-answer.md), which it never writes over, writes nothing for an unchanged applicant, returns an approved one to review only when their answers, normalised, changed something the solver reads, and leaves an application absent from the file exactly as it is ([ADR 0011](../../adr/0011-re-import-upserts-on-market-and-email.md)).

**A row's answers and its "back to review" are one update, held to what the row's read found** (`_write_row`, T270).
`record_application_answers` passes `held`, the application as read, and `back_to_review` to `update_application_form_data`, which writes only while the status and the verdict's time are still those, so a request cut short after the answers cannot leave a vendor approved on answers nobody saw, and importing the file again finds nothing left to repair.
A held write that matches nothing answers `ANSWERS_MOVED`: a verdict was given between the read and the write, so the row is read and decided again on what is stored then, and an approval that landed first goes back to review.
After `ROW_TRIES`, three tries in all, the row is a row failure: "This application changed while the file was imported, so its row was left out. Import the file again to bring it in."
A new row's application is written held to the document `find_or_create_application` returned, and `returnedToReview` counts the rows written with `back_to_review`.

**`submitted_at` is the form's own timestamp**, an ordinary mapping target, optional, and auto-detected from Google Forms' "Timestamp" heading; it is normalised to ISO 8601 at the boundary (`normalized_submitted_at`, [the application document](../data/application-document.md#the-fields-that-matter)).
A row without one gets the import's moment, so the screen warns when the market orders by arrival and nothing maps it (`orders_by_submitted_at`, [priority and tie-breaks](../../business/rules/priority-and-tie-breaks.md)); the warning, not a refusal, because a market with no rule on arrival does not need the column.

**A column's "Maps to" is found by typing.**
Each row of the ledger is one [`ChoiceField`](../../design-system.md#the-primitive-layer), built by `mapsTo` in [`CsvImportView.vue`](../../../front-end/src/views/CsvImportView.vue) and written as it is chosen; past 12 choices its list lies over the rows below, so no row moves, and a list on the last row is reached by scrolling the page.
Every row counts the same choices, each target and a column's two ways out, though a grid has one way out, so a ledger never mixes a select with a field.
Its groups come in this order: Ignore ("Ignore this column" or "Ignore these columns", value `''`, and on a column "This column has nowhere to go…", which never reaches the server), then, following `ImportTarget.kind`, Essential (`identity`, `essential`, and Submitted at) and Your questions (`custom`, and "From your sheet").
The ways out come first so that the cap never hides them, however many targets a market has, and an unmapped row's list opens at its head rather than at its tail.
Words typed draw only the groups they found, so what they find leads the list rather than a heading with nothing under it.
A target another row holds is disabled with `Mapped from "<heading>"`, cut to two lines as the row's own heading is, and is free again once that row lets it go.

**Values are matched forgivingly, once.**
Surrounding space and capitals match silently; anything else is shown once per distinct value and settled by hand, and those settlements (`resolutions`) are saved with the mapping.
One question may be one column or, for a Google Forms checkbox grid, one column per option; both import to the same stored answer.
Values are offered and compared in the organizer's words, never the stored ones: a date reads as a date, and a table choice as its label rather than its code.
Each value is settled in [`ValueFixes.vue`](../../../front-end/src/components/ValueFixes.vue), one [`ChoiceField`](../../design-system.md#the-primitive-layer) per value: a select for a question of 12 answers or fewer, past that a field that finds an answer by typing, with "Ignore this value" first on either, passed as `ChoiceField`'s `leads`, so neither the cap nor words that find nothing else hide it (T263).
**A fix can only name an answer the question offers**: the import stores what a fix names, and `application_write.py` refuses a select's answer that is no option ("must be one of"), so words typed and not chosen clear on leaving the field, and no typed fix is offered.
The rows offered one set of answers share one list of choices, keyed by the target and the answers, since a tier grid's target offers two sets: the dates to its day headings and the tiers to its cells.
Every value still waiting is drawn; those already decided stop at 6 and "Show all".

**Nothing is written until the final confirm, so leaving before it asks** (T271).
The mapping and every value settled live in the view alone, and a link, Back or a reload dropped them with no word.
`holdsAMapping` is true on Map columns, and on Preview while no import is running, and the view hands it to [`useUnsavedWork`](../conventions/unsaved-work-asks-before-it-is-dropped.md) with its sentence, so a move off the page opens the one leave question and a reload the browser's.
"Cancel import" leaves by `router.push`, so it asks through the same guard; a jump to another market's import is a new path of the same route, so it asks too, before the view's `watch(marketId)` starts that market at Upload.
Upload holds no file and the done step has written it, so neither asks; nor does an import running (`busy` on Preview), which leaving does not stop.
The import's own Back stays in the page and never asks, though from Map columns it drops the file (`startOver`).

**A list of a file's rows stops at 20, and is read whole by asking.**
The preview's refused rows and the done step's are [`ImportRefusedRows.vue`](../../../front-end/src/components/csvImport/ImportRefusedRows.vue), the preview's replaced and rejected rows the view's own, each a [`ListFrame`](../../design-system.md#the-primitive-layer) with `showAll` and `IMPORT_LIST_FIRST`, so a bad file does not push the confirm 361 rows down.
Each finds by what `utils/importPreview.ts` says it holds: a refused row by address, row number and reason, a replaced row by address and either row it names, a rejected row by name and address.
None has a `findKey`, since the words last as long as the step.
The samples are not a frame: they are a few rows, with the first open.

**A grid is never split; one column is split where the comma is not inside an option.**
A grid carries its option in each column's heading, so a cell is never cut up; a checkbox question in one column holds its chosen options joined by commas, and an option may hold a comma of its own.
`split_options` takes every known option (what the question offers, and every value already matched) whole wherever its pieces appear, the longest first, comparing whole pieces only, so "Gold" never matches inside "Gold Plus"; otherwise a comma inside parentheses, or after a weekday that a day of the month follows, belongs to the option (bug 27).
What no reader can settle is an option made of others ("Prints, Cards" offered beside "Prints" and "Cards"): `comma_bearing_targets` names such targets, and the mapping step warns when one column is mapped to one ("One column cannot answer … reliably"), since Google threw away which commas separated answers.
It warns and does not refuse: any value still unmatched must be settled by hand before the preview, so nothing wrong is imported either way, and refusing would strand an organizer whose only copy of the answers is that file; their real fixes are a grid, or renamed options.

**There is one mapping format**, `mapping_payload`: targets by header TEXT, never position, with the file's headers, the resolutions, when, and who made it (`madeBy`: the import, or the start from a CSV).
The import saves it on the market's `importMapping` on every import (`save_mapping`), once every refusal is decided and before any row is written, through [the market write](market-write.md): it holds the market's phase and its `importMapping` as the import read them, so an import meeting a market that moved, or another import's mapping saved since, answers the one 409 with [its sentence](market-write.md#what-it-answers), and writes no application; the next `inspect` restores it with `restore_mapping`; a target whose headers are not all present is reported as missing rather than half-restored, because a partly mapped grid looks answered.
A saved target the form lacks is skipped, which is how the start's left-out columns wait under their would-be keys ([the CSV proposal and start](csv-proposal-and-start.md)); the targets that are not questions (`RESERVED_TARGETS`: who applied, when, the sheet's note) are never a question's key: the start's `key_for` passes over them and the form's save refuses them.
The start from a CSV writes the same format, so the first import of a later export opens with every column restored and every value matched ([the CSV proposal and start](csv-proposal-and-start.md)); do not give anything a mapping shape of its own.

**After the writes, the [automatic rejection](../../business/rules/automatic-rejections.md) rules judge** what the import wrote and anything else undecided, and the result counts how many they rejected (`rejectedByRules`) and returned to undecided (`returnedByRules`), returning one only when the importer may overturn an automatic rejection (`may_overturn`, E38/F06/S01).
The preview judges the file first, writing nothing (`_rule_rejections`): each row's application as the import would leave it, judged only where a rule may judge it (`is_judgeable`), its answers as stored with an organizer's update read in place, so it names the rows the import's judging will newly reject (E38/F03/S02).
An organizer's own column mapped to "From your sheet" replaces each imported vendor's sheet note ([vendor notes](vendor-notes.md)).

**An import records one entry in [the market's history](../data/history.md)**, `imported` with its counts, however many rows it wrote: `import_applications` in `app.py`, the route that asks the table's row, records it once the import answers 200.
Then, with reviewers chosen, the route deals every row the import left open and undealt to the next reviewer in turn (`deal_arrivals` in [`back-end/review_team.py`](../../../back-end/review_team.py)), after the rules have judged and a first import has taken the market into Review, and records that as one `dealt` entry ([the review is dealt among chosen reviewers](../../business/rules/the-review-is-dealt-among-chosen-reviewers.md)).
A first import's reviewers are chosen on its preview step, whose confirm, when they changed, writes them through `PUT /markets/:id/reviewers` before it posts the import, so its rows are dealt this way from the first ([the import](../../business/flows/import.md#h2a-first-import-everything-maps)).

## Superseded

- Matching answers against the offering before splitting a column was rejected, for a warning alone (wayfinding/readable-journey/05); since a split cut options with commas in half, known options are taken whole first, comparing whole pieces so one name inside another never matches, and the warning is left for an option made of others (bug/27).

## Why

- [Intake mode decides how vendors arrive](../../business/rules/intake-mode-decides-how-vendors-arrive.md): importing is the CSV path's way in, refused on a form market.
- [What an import may leave unasked](../../business/rules/what-an-import-may-leave-unasked.md): the one answer an imported row may leave out.
- [An imported email is asserted](../../business/rules/an-imported-email-is-asserted.md): the file's address is the organizer's word, which must be settled before any mail but a sign-in code.
- [Priority and tie-breaks](../../business/rules/priority-and-tie-breaks.md): a row must carry its own `submitted_at` for first come, first served to decide anything.
- [A re-import upserts on the market and the address](../../adr/0011-re-import-upserts-on-market-and-email.md).

`back-end/tests/test_csv_import.py`, `back-end/tests/test_a_re_imports_back_to_review_lands_with_the_answers.py`, `front-end/src/__tests__/aFileThatIsNotCsv.test.ts`, `front-end/src/__tests__/aResponsesFileTooLargeToSend.test.ts`, `front-end/src/__tests__/theImportAsksBeforeItDropsAMapping.test.ts`, `front-end/e2e/csv-import.spec.ts`, `front-end/e2e/the-import-lines-up.spec.ts` and `front-end/e2e/the-import-asks-before-it-drops-a-mapping.spec.ts` pin it; the synthetic exports it is held to are [the Google Form corpus](../../../back-end/tests/test_data/README.md).

What the organizer does on the import, step by step, is [importing a Google Form's responses](../../business/flows/import.md).

The glossary concepts it serves: [Intake mode](../../business/concepts/intake-mode.md) and [Application](../../business/concepts/application.md).
