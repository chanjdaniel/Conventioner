---
layer: business
kind: flow
describes:
  - front-end/src/views/CsvImportView.vue
verified: 2026-11-10
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
  - E38/F03/S01
  - E38/F03/S02
  - E38/F07/S02
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
  - E38/F04/S01
  - E38/F04/S03
  - E38/F06/S01
  - E38/F15/S02
  - T181
  - T211
  - T205
  - T204
  - T223
  - T271
  - T263
---

# Importing a Google Form's responses

**Who:** the market's Admin or owner; an Editor or a Viewer is offered no import on the rail, and the import itself tells them the import row's words, "Only an Admin or the owner may import applications or start this market from a CSV." (bug 37).
**Where they start:** a market whose vendors apply on the organizer's own Google Form: in Draft the rail's main button "Import responses" for the first import, which takes the market into Review once written; in Review the rail's More…, "Redo import" (E38/F04).
**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md).

Importing is the Google Form path's alone, in Draft and in Review ([intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md)): a market whose vendors apply on its own page offers no import, and the server refuses one with "This market takes applications on its own page, so nothing is imported into it."
The import is `/markets/<id>/import` ([`CsvImportView.vue`](../../../front-end/src/views/CsvImportView.vue)), headed "Import responses" for the first import, its done step included, and "Redo import" after it, in four steps: Upload, Map columns, Preview, Confirm.
It is a full-width page of its own, not a dialog and not a card of Market Setup: mapping a dozen columns and then settling the answers that match nothing is too dense for either.
It stands in the market frame at the workspace width like every market page, and keeps that width through all four steps, since a page that resized under the organizer at each Next would read as unsteady: Upload, Preview and Confirm centre a narrower panel (720px) inside it, and Map columns takes the whole width for its ledger and rail.
Its heading and every step stand on the frame's inset, in line with the rail, as every page in the card does ([the market frame](../../implementation/modules/market-frame.md#sharp-edges)); until T181 they sat 8px further in, and `csv-import.spec.ts` measures the line at 1920 and 1440 on the first import and on Redo import.
A dialog opened from the import, such as the form amendment ([H2e](#h2e-add-a-question-for-a-column-with-nowhere-to-go)), is a dialog over a page, which holds only while the import is a page.
How the file becomes applications, and why each rule holds, is [the CSV import](../../implementation/modules/csv-import.md).

**Map columns is a ledger of the file's columns**: one row per column in file order, each with its "Maps to" choice, and "Required questions" beside it ticking off what is served.
"Maps to" is grouped under Ignore, Essential and Your questions, the ways out first so that a long list never hides them, and past 12 choices it is a field that finds a question by a word of its label.
A question another column holds stays in the list, shown as taken and by which column, until that column lets it go.
A question spread over several columns is one row with its columns beneath it, labelled with its shape ("3 columns · one per option"), and a list in one column says so too ("1 column · values split on commas").
An answer that matches nothing is settled inside the row of the column it came from, where the organizer is already looking.
The ledger won over a board of questions to fill and a walk-through of one question at a time because a later import opens with the mapping restored: a filled ledger is read for its exceptions, while the other two opened with nothing left to do.
Its cost is that a first import is the least guided of the three.

**Task:** "Bring in the applications you collected in your spreadsheet."

## H2. Import applications from a CSV

**Status:** Works (re-walked live on 2026-10-03; where it is offered read from the code as of E31/F03/S04 and E38/F04: `back-end/csv_import.py`, `front-end/src/utils/importPhase.ts`, `a-late-export.spec.ts`).
Each case below is one of its branches.
Covered by:

- `a-late-export.spec.ts`
- `automatic-rejections.spec.ts`
- `csv-import.spec.ts`
- `form-amendment.spec.ts`
- `market-journey.spec.ts`
- `the-import-lines-up.spec.ts`
- `the-upload-steps-are-one.spec.ts`

### H2a. First import, everything maps

**Status:** Works (re-walked live on 2026-10-03 for P1 and P2; the automatic rejections read from the code as of E33/F03/S02, the preview's rows as of E38/F03/S02, and its reviewers as of E38/F07/S02: `the-first-import-offers-the-reviewers.spec.ts`).
On a first import only Timestamp and Email Address are mapped for you, even where a heading matches a question word for word (a usability observation, not a bug).

1. **Upload:** "Choose the CSV your form produced", by dropping it on the drop zone or choosing a file ("Drop your CSV here, or choose a file", hinting "Any form tool or spreadsheet that exports CSV will do." and that every column comes across), which takes no other file while one is read; the page names the market ("Importing into …") and says what the import does: on a first import, "Once the import is written, the market enters Review."; on a Redo import, that the whole responses file is read again and the market stays in Review.
   A draft that would be kept out of Review, by an incomplete setup or by Review setup's two decisions not yet taken ([review waits on the review setup](../rules/review-waits-on-the-review-setup.md)), is told everything it lacks before a file is picked, and nothing is written: "This market is not ready for its first import", then "Before its first import, this market needs:" and every blocker of the move into Review at once, in the guards' order, each with its link to where it is done for someone who may do it ("Pick market dates", "Add a location" and "Add tables" to Market Setup, "Decide what reviewers read first" and "Decide the automatic rejections" to Review setup), and without a link for anyone else (`the-first-import-lists-what-it-waits-on.spec.ts`).
   Someone who may not import reads "Importing into this market is not yours to do" and its reason instead; a market whose vendors apply on its page, reached by its address, reads "Vendors apply on this market's page" and the server's own sentence, "This market takes applications on its own page, so nothing is imported into it.", in any phase; and a market past Review its one sentence; "Back to the market" sits under all four, its one way out, with no stepper and no "Cancel import", since there is nothing to take or cancel.
   A file that is not a CSV export, such as a binary named `.csv`, stays on Upload with "This file does not look like a CSV export. Download the responses again from Google Forms as .csv.", announced as it appears, and another file can be chosen (E38/F15/S02).
2. **Map columns:** "N columns in this file" ("1 column in this file" for one), then every column in file order with sample answers, mapped to a question or "Ignore this column"; "Required questions" ticks each one off; "All required questions are mapped."
3. **Preview** ("Preview import"): "N of M rows will be imported", ending "; K of them will be rejected by your automatic rejections" when a rule rejects any, then "Each imported row becomes an application awaiting your review. Nothing has been written yet.", which, when a rule rejects any, reads "...awaiting your review, except the K listed below, which arrive already rejected. Nothing has been written yet."
   "The first N rows, as they will be imported" checks the mapping: the first rows that import and no rule rejects, as a list of rows that expand, each headed by the vendor's name over their email and its file row ("Row 2"), the first open.
   A row opens to its answers as the review card lays them out: the market's highlighted answers, then "N more answers" ([review highlights](../rules/review-highlights.md)).
   "Rejected by your automatic rejections", with its count, checks the rules: every row the import's judging will newly reject, in the same format, each marked "Rejected" and opening on "Rejected automatically:" and its reason; its line says who may overturn one, as the market's row "Change a verdict, or overturn an automatic rejection" stands (`rejectedRowsWhy`, "an Admin or the owner" by default, E38/F06/S01).
   Its first 20 rows show, then "Show all N", and past 12 a field finds a row by name or address.
   Then "Where each answer comes from".
   Last, on a first import and for someone who may choose reviewers (an Admin or the owner, by default), "Reviewers": a field that finds each person they may choose by typing, the chosen as chips above it, none at first (or the reviewers chosen in draft before, each who can no longer review here saying so on their chip), and the hint "Choose no one and everyone reviews first come, first served. You can choose reviewers later from the Applications tab." ([the review is dealt among chosen reviewers](../rules/the-review-is-dealt-among-chosen-reviewers.md)).
   Its confirm waits first for a write of the reviewers a previous page left unanswered, so a refusal shows here and nothing imports; that page's own confirm stops at its write, so a file it held is never imported, here or into the market then on screen, and the person who leaves during the write and never comes back has a draft still waiting on its first import, its reviewers saved if the write was accepted.
   A jump through history to another market's import asks first from Map columns or Preview, as any move off the import does there (below), and, once left, starts that market at Upload, without the file, and so does a jump there and back.
   The answer to a read of the file, a preview or an import sent before the jump changes nothing on screen: what an import wrote is on the first market, and a refusal is shown to no one.
   "Fix the form" closes at such a jump, and its form read, answered after one, opens nothing, so the first market's form is never saved over the other's; a save already sent lands on the first market.
   A Redo import offers no reviewers: by then they are the Reviewers panel's ([dividing the review](review.md#dividing-the-review)).
4. **Confirm** ("Import N rows"): when the reviewers chosen differ from the ones it started from, they are saved first, so every imported row is dealt to the next reviewer in turn as it arrives; a save that is refused shows its error under the reviewers and imports nothing, and an import refused after the save shows its error as any refused import does, the reviewers staying chosen.
   Then "Imported N new applications."; on a first import "This market is now in Review: decide every application, then begin assignment.", and "Go to the review" leads to Applications (bug 16).
5. Expect N applications, each Open and awaiting review, except those an automatic rejection rejects: "N were rejected by your automatic rejections, each with its reason; an Admin or the owner can overturn any of them.", naming whoever the market's change row lets overturn them ([F3](form-tab.md#f3-what-a-reviewer-reads-first)).

For a market started from a Google Form, step 2 opens "Mapped when your form was started from this file." and needs no decisions; a later import opens "Restored from your last import."

**Leaving before the import is written asks first** (T271).
On Map columns and Preview, "Cancel import", a tab, a link, Back or a jump to another market's import opens "Leave without saving?": "Nothing from this file is imported yet. Leaving drops the column mapping and every value you settled.", with Stay, which keeps the step, the mapping and every value settled, and Leave, which goes where the organizer asked.
A reload or closing the tab is asked by the browser, in its own words ([unsaved work asks before it is dropped](../../implementation/conventions/unsaved-work-asks-before-it-is-dropped.md)).
Upload and the done step leave without asking, "Back to applications" and "Go to the review" included, and so does a page whose import is being written, since leaving does not stop it.
The import's own Back stays inside the page and never asks; from Map columns it returns to Upload, without the file (`the-import-asks-before-it-drops-a-mapping.spec.ts`).

### H2b. Answers that match no option

**Status:** Works (re-walked live on 2026-10-03).
Answers are split only where the comma is not inside an option, so "Monday, November 20th" arrives whole and reads as that market date (bug 27).
"N values did not match …" lists each unmatched answer with "Choose…" to match it to an option, or "Ignore this value"; "Re-check values" re-runs the check.
A question of 12 answers or fewer keeps a select; past that the organizer finds the answer by typing in a field on the value's row, its list lying over the rows below so none moves, and 142 values among 129 answers read 142 fields (T223).
Words typed and not chosen clear on leaving the field, since a fix can only name an answer the question offers, and "Ignore this value" stays the list's first row whatever is typed (T263); once a value is fixed past 12, another answer or "Ignore this value" replaces the fix, as the field has no empty row.
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
A custom question can be made optional on Market Setup's form while the market is a draft, before its first import ([F5](form-tab.md#f5-reopen-the-market-to-fix-the-form)); an essential constraint cannot be switched off, so the only fix is a new column in the spreadsheet.

### H2e. Add a question for a column with nowhere to go

**Status:** Works (`form-amendment.spec.ts`), on a first import, while the market is a draft.

1. A column that matches nothing shows "This column has nowhere to go…" and "Add a question for it".
2. The dialog "Fix the form" lists "Questions this market asks" and offers "Add a question" (Question, Answer key), prefilled from the column.
3. Save: the form is written, as Market Setup would write it, and the market stays a draft; "Your upload and your mapping stay exactly as they are."

Refused when it would leave the form asking nothing, which could not enter Review.
Once anything is imported the questions are fixed, and the dead end says so in the lock's own words ("The questions are fixed: …") instead of offering the dialog.
How it works is [the form amendment](../../implementation/modules/form-amendment.md).
Covered by:

- `form-amendment.spec.ts`

### H2f. Stop asking a preference the form never asked

**Status:** Works (walked live), on a first import, while the market is a draft.
On a market whose form does ask the preference, it says the file has no column for it, not that the form never asked (bug 40).
"Your form never asked <question>. It is a preference, not a constraint…" with "Stop asking it", which opens the same dialog as H2e to switch that essential question off.

### H2h. Import a later export

**Status:** Works (walked live; re-walked on 2026-10-03, where ten repeat submissions folded into their latest rows).
An applicant listed more than once is one application, from their latest row, dated by their first; an unchanged applicant keeps their verdict, and "N updated" counts only changed answers (bugs 34 and 40).
Why a later export updates rather than adds, and why only a changed answer the solver reads sends an approval back: [ADR 0011](../../adr/0011-re-import-upserts-on-market-and-email.md).

1. The mapping is restored by column heading; "N columns are new since then." and lost columns are named to map again.
2. The preview says "N new, M updated, K unchanged"; how many approved applications "will return to review" because their answers changed; and how many existing applications are not in the file ("They will be left exactly as they are.").
   A file with nothing new reads "Nothing to import: N of M rows are already here, unchanged", and its button "Import nothing new"; otherwise the button counts the rows the headline counts, so an unchanged row is never among them.
   When a rule newly rejects any row, the headline adds "; K will be rejected by your automatic rejections", which says "K of them" except when some rows are unchanged and others are still written, where it drops "of them".
3. Confirm: "Imported N new applications, updated M."

A first-come-first-served priority rule with no column mapped to "Submitted at" warns that "That rule will order nothing."
On the Google Form path a later export comes in from Review with the rail's "Redo import" (H2j).

### H2i. Rows that cannot be imported

**Status:** Works (re-walked live on 2026-10-03).
The preview lists "N rows will be skipped" with every reason for each row, and confirming writes only the good rows (bug 5).
A bad file does not push the confirm down: the list shows its first 20 rows, then "Show all N", "Show fewer" once they are all drawn, and past 12 rows "Find by address, row number or reason"; the done step's "N rows skipped" reads the same (`lists-at-scale.spec.ts`).
The earlier submissions a preview says will be replaced stop at 20 the same way, found by address or row.
A blank row says "Every column this import reads is empty."; an answer the organizer chose to ignore on a required question says so, rather than that the applicant left it blank, and the fix is on the previous step.

### H2j. Import after review has begun

**Status:** Works (read from the code as of E38/F04/S03: `MarketApplicationsTab.vue`, `PhaseRail.vue`, `a-late-export.spec.ts`).
The Applications page offers no import on either path.
In Review the rail's More…, "Redo import", opens the import; the whole responses file is read again, new rows added and changed ones updated (H2h), the market stays in Review, and every verdict is kept except as H2h says.
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

Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
