---
layer: business
kind: flow
describes:
  - front-end/src/views/CsvImportView.vue
verified: 2026-10-29
sources:
  - wayfinding/readable-journey/05
  - wayfinding/v0-1-0/04
  - wayfinding/v0-1-0/05
  - wayfinding/the-order-of-the-work/06
  - wayfinding/the-order-of-the-work/map
  - E24
  - E26
  - E30/F02/S01
  - E31/F03/S04
  - E32/F02
  - E33/F03/S02
  - E01
  - E20
  - E20/F02/S01
  - bug/5
  - bug/16
  - bug/24
  - bug/26
  - bug/27
  - bug/28
  - bug/34
  - bug/37
  - bug/40
  - bug/42
---

# Importing a Google Form's responses

**Who:** the market's Admin or owner; an Editor or a Viewer is shown the import and told the import row's words, "Only an Admin or the owner may import applications or start this market from a CSV." (bug 37).
**Where they start:** a market whose vendors apply on the organizer's own Google Form, in Import (or Imported): either the rail's "Import responses" from Draft, which lands here, or "Import from CSV" on the Applications page.
**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md).

Importing is the Google Form path's alone, in every phase it imports in ([intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md)): a market whose vendors apply on its own page offers no import, and the server refuses one with "This market takes applications on its own page, so nothing is imported into it."
The import is `/markets/<id>/import` ([`CsvImportView.vue`](../../../front-end/src/views/CsvImportView.vue)), headed "Import applications", in four steps: Upload, Map columns, Preview, Confirm.
It is a full-width page of its own, not a dialog and not a card of Market Setup: mapping a dozen columns and then settling the answers that match nothing is too dense for either.
It stands in the market frame at the workspace width like every market page, and keeps that width through all four steps, since a page that resized under the organizer at each Next would read as unsteady: Upload, Preview and Confirm centre a narrower panel (720px) inside it, and Map columns takes the whole width for its ledger and rail.
A dialog opened from the import, such as the form amendment ([H2e](#h2e-add-a-question-for-a-column-with-nowhere-to-go)), is a dialog over a page, which holds only while the import is a page.
How the file becomes applications, and why each rule holds, is [the CSV import](../../implementation/modules/csv-import.md).

**Map columns is a ledger of the file's columns**: one row per column in file order, each with its "Maps to" choice, and "Required questions" beside it ticking off what is served.
A question spread over several columns is one row with its columns beneath it, labelled with its shape ("3 columns · one per option"), and a list in one column says so too ("1 column · values split on commas").
An answer that matches nothing is settled inside the row of the column it came from, where the organizer is already looking.
The ledger won over a board of questions to fill and a walk-through of one question at a time because a later import opens with the mapping restored: a filled ledger is read for its exceptions, while the other two opened with nothing left to do.
Its cost is that a first import is the least guided of the three.

**Task:** "Bring in the applications you collected in your spreadsheet."

## H2. Import applications from a CSV

**Status:** Works (re-walked live on 2026-10-03; where it is offered read from the code as of E31/F03/S04 and E32/F02: `back-end/csv_import.py`, `front-end/src/utils/importPhase.ts`, `a-late-export.spec.ts`).
Each case below is one of its branches.
Covered by: `csv-import.spec.ts`, `form-amendment.spec.ts`, `a-late-export.spec.ts`, `the-import-lines-up.spec.ts`, `market-journey.spec.ts`.

### H2a. First import, everything maps

**Status:** Works (re-walked live on 2026-10-03 for P1 and P2; the automatic rejections read from the code as of E33/F03/S02).
On a first import only Timestamp and Email Address are mapped for you, even where a heading matches a question word for word (a usability observation, not a bug).

1. **Upload:** "Choose the CSV your form produced", by dropping it or choosing a file; the page names the market ("Importing into …").
2. **Map columns:** every column in file order with sample answers, mapped to a question or "Ignore this column"; "Required questions" ticks each one off; "All required questions are mapped."
3. **Preview** ("Preview import"): "N of M rows will be imported", "Each imported row becomes an application awaiting your review. Nothing has been written yet.", the first rows as they will be stored, "Where each answer comes from".
4. **Confirm** ("Import N rows"): "Imported N new applications."; "Back to applications" returns to Applications (bug 16).
5. Expect N applications, each Open and awaiting review, except those an automatic rejection rejects: "N were rejected by your automatic rejections, each with its reason; a reviewer can overturn any of them." ([F3](form-tab.md#f3-what-a-reviewer-reads-first)).

For a market started from a Google Form, step 2 opens "Mapped when your form was started from this file." and needs no decisions; a later import opens "Restored from your last import."

### H2b. Answers that match no option

**Status:** Works (re-walked live on 2026-10-03).
Answers are split only where the comma is not inside an option, so "Monday, November 20th" arrives whole and reads as that market date (bug 27).
"N values did not match …" lists each unmatched answer with "Choose…" to match it to an option, or "Ignore this value"; "Re-check values" re-runs the check.
Values already decided, including those a Google Form start saved, are listed as "N values already decided - change any that are wrong" and can be changed (bug 28).
"N values still need a match." blocks the preview until each is settled.

### H2c. A question spread over several columns

**Status:** Works (`csv-import.spec.ts`): a tier grid's day headings, in whatever words, are matched to the market's dates, and its cells to tiers (bug 26).
Grid questions (one column per option or per day, such as a tier grid) are grouped as one row showing their columns; "Not one question - split" treats them separately.
A column whose options contain commas while its answers are comma-separated says "One column cannot answer … reliably": one of the options is made of others, so which commas separate answers cannot be known, and the fixes are a grid or renamed options ([the CSV import](../../implementation/modules/csv-import.md)).

### H2d. A required question has no column

**Status:** Works (walked live).
"Number of dates you want" is not required of a file: a vendor with no answer is limited by their availability and the market's ceiling (bug 24, [what an import may leave unasked](../rules/what-an-import-may-leave-unasked.md)).
The preview stays disabled until every required question is mapped; "Required questions" shows which are missing ("Still unmapped: …").
A custom question can be made optional by reopening for editing ([F5](form-tab.md#f5-reopen-the-market-to-fix-the-form), before any application exists); an essential constraint cannot be switched off, so the only fix is a new column in the spreadsheet.

### H2e. Add a question for a column with nowhere to go

**Status:** Works (code), only while no application exists yet.

1. A column that matches nothing shows "This column has nowhere to go…" and "Add a question for it".
2. The dialog lists "Questions this market asks" and offers "Add a question" (Question, Answer key).
3. It warns: "While this runs, this market's public application page is briefly unavailable." and that the form's publication date will be re-dated.
4. Confirm: the market steps back to Draft, the form is written, and the market returns to the phase it started in; "Your upload and your mapping stay exactly as they are."

Refused when it would leave the form asking nothing, or when a guard on the way back would fail; each blocker is named before anything moves.
How the chain runs is [the form amendment](../../implementation/modules/form-amendment.md).
Covered by: `form-amendment.spec.ts`.

### H2f. Stop asking a preference the form never asked

**Status:** Works (walked live), only while no application exists yet.
On a market whose form does ask the preference, it says the file has no column for it, not that the form never asked (bug 40).
"Your form never asked <question>. It is a preference, not a constraint…" with "Stop asking it", which runs the same chain as H2e to switch that essential question off.

### H2g. Finish a fix that stalled

**Status:** Works (code).
If the H2e or H2f chain stops part way, the dialog says where it stopped and offers "Put the market back".

### H2h. Import a later export

**Status:** Works (walked live; re-walked on 2026-10-03, where ten repeat submissions folded into their latest rows).
An applicant listed more than once is one application, from their latest row, dated by their first; an unchanged applicant keeps their verdict, and "N updated" counts only changed answers (bugs 34 and 40).
Why a later export updates rather than adds, and why only a changed answer the solver reads sends an approval back: [ADR 0011](../../adr/0011-re-import-upserts-on-market-and-email.md).

1. The mapping is restored by column heading; "N columns are new since then." and lost columns are named to map again.
2. The preview says "N new, M updated, K unchanged"; how many approved applications "will return to review" because their answers changed; and how many existing applications are not in the file ("They will be left exactly as they are.").
   A file with nothing new reads "Nothing to import: N of M rows are already here, unchanged".
3. Confirm: "Imported N new applications, updated M."

A first-come-first-served priority rule with no column mapped to "Submitted at" warns that "That rule will order nothing."
On the Google Form path a later export comes in from Review with the rail's "Import more responses" (H2j).

### H2i. Rows that cannot be imported

**Status:** Works (re-walked live on 2026-10-03).
The preview lists "N rows will be skipped" with every reason for each row, and confirming writes only the good rows (bug 5).
A blank row says "Every column this import reads is empty."; an answer the organizer chose to ignore on a required question says so, rather than that the applicant left it blank, and the fix is on the previous step.

### H2j. Import after review has begun

**Status:** Works (walked live; the review's side read from the code as of E32/F02/S02 and E32/F02/S03: `MarketApplicationsTab.vue`, `a-late-export.spec.ts`).
"Import from CSV" is on the Applications page only while the market is importing (Import, or Imported for a market standing there).
Review offers no import: the rail's More…, "Import more responses", takes the market back to Import in one move and lands here, keeping every verdict.
A market in Review reached at its import's address is told "…importing would change who has applied while their applications are being decided. Use Import more responses, under More… on the phase rail, then import."
From Assignment onwards it is refused for good, and says so: "…past review, so it takes no more applications and nothing more can be imported." (bug 42).

## The rules it obeys

- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): importing is the Google Form path's.
- [What an import may leave unasked](../rules/what-an-import-may-leave-unasked.md): no personal limit is an answer.
- [No question is inferred required](../rules/no-question-is-inferred-required.md): a form started from the file requires only what the organizer marked.
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md): H2e and H2f only while nobody has applied.
- [Priority and tie-breaks](../rules/priority-and-tie-breaks.md): a row carries its own submission time.
- [What each role may do](../rules/what-each-role-may-do.md): importing is an Admin's.
- [Vendor notes](../rules/vendor-notes.md): the organizer's own column maps to "From your sheet", which each import replaces.
- [A re-import upserts on the market and the address](../../adr/0011-re-import-upserts-on-market-and-email.md): what a later export does to the applications already here.

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
