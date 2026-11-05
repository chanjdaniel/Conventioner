---
layer: business
kind: flow
describes:
  - front-end/src/views/StartFromCsvView.vue
  - front-end/src/utils/csvProposal.ts
  - front-end/src/components/csvProposal/ProposalLedger.vue
  - front-end/src/components/market/DraftedFrom.vue
  - front-end/src/utils/draftedFrom.ts
verified: 2026-11-04
sources:
  - wayfinding/the-form-started-from-a-csv/05
  - wayfinding/the-form-started-from-a-csv/map
  - E24/F03
  - E24/F04/S02
  - E26/F02/S07
  - E30/F02/S01
  - E31/F03/S01
  - E33/F02/S01
  - bug/4
  - bug/24
  - bug/27
  - bug/41
  - E38/F02/S01
  - E38/F15/S02
  - T205
  - T213
---

# Starting from a Google Form's responses

**Who:** the market's Admin or owner, while the market is a draft whose form has no questions of its own.
**Where they start:** the create-market dialog's "On my own Google Form" ([D2](creating-a-market.md#d2-create-a-market-that-starts-from-a-google-form)), or Market Setup; the flow is `/markets/<id>/start-from-csv` ([`StartFromCsvView.vue`](../../../front-end/src/views/StartFromCsvView.vue)), headed "Draft this market from a Google Form".
**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md).

The organizer uploads last year's (or this year's) responses, and the market's plan facts and questions are proposed from the file's columns for them to adjust.
It drafts; it imports no one, and both Market Setup and the Upload step say so, with how vendors come in after by the market's intake (T205, F20 of the 2026-11-02 walk).
It is for an organizer whose Google Form is the real form, who would otherwise retype its questions so the import has somewhere to put each column; an organizer taking applications on the market's own page can seed this year's form from last year's responses the same way, at no extra cost.
The flow is four steps at one address, "1 Upload", "2 Year", "3 Review", "4 Confirm"; Back, Cancel and leaving write nothing, and a reload lands back on Upload, since the file is not kept.
Its heading stands on the frame's inset, in line with the rail, as the import's does; its refusal, Upload and "Reading your columns…" stand in a 720px panel centred in the page, where [the import](import.md)'s Upload stands, and take the file on the same drop zone; the proposal's ledger takes the whole width (T205).
Nothing is written until the organizer confirms, and the file is not stored ([the CSV proposal and start](../../implementation/modules/csv-proposal-and-start.md)).
The confirm also saves the import's column mapping, so the first import of the same file opens "Mapped when your form was started from this file."
It keeps, too, what the file said of each question and each column left out, as far as it names nobody (answers at least 3 applicants gave, holding no address, link, handle, phone number or street address), so the Questions tab can fill a question's options from it, or add a left-out column as a question, after the start ([building the application form](form-tab.md#f2-custom-questions)).
It keeps every answer too, one-offs included, for an option on the Questions tab to offer: less any holding an address, link, handle, phone number or street address, and none of a column whose answers are mostly different, such as Discord usernames, shop names or answers in sentences.
Only someone who may change the form reads those, and only while it can still change ([ADR 0023](../../adr/0023-every-answer-for-an-option-to-offer.md)).
Only column headings and the shape of their answers are sent to TypeSafe, and the upload step says so; no applicant's answer leaves Conventioner.
Covered by:
- `start-from-csv.spec.ts`
- `the-landing-says-what-remains.spec.ts`
- `the-upload-steps-are-one.spec.ts`
- `where-a-form-starts.spec.ts`

## G1. From the create-market dialog

**Status:** Works (walked live).
See [D2](creating-a-market.md#d2-create-a-market-that-starts-from-a-google-form).

## G2. From an existing draft

**Status:** Works (walked live).
Market Setup, How vendors apply, "Draft from a Google Form's responses"; it works for either intake and leaves the intake choice as it is.
Under it a help line follows the intake chosen above, as it is clicked: on "Vendors apply on this market's page", "Drafts this market's dates, tiers and questions from a past Google Form's responses. It imports no one: vendors apply on the market's page once applications open."; on "I collect applications elsewhere", "Drafts this market's dates, tiers and questions from your Google Form's responses. It imports no one yet: once the market is ready, import the responses with Import responses, the next step at the top of the market's pages."
Disabled, with the reason under the help line, once the form has questions of its own: "This market's form already has questions of its own, so it can't be started from a Google Form's responses."
Past Draft, Market Setup is settled and offers no start; the flow's own address says, under "This market can't be drafted from a Google Form", "Only a draft market can be started from a Google Form's responses."

## G3. Upload and the year question

**Status:** Works (walked live).

1. Under "Choose a responses file to draft from", drop or choose the CSV on the zone "Drop your CSV here, or choose a file", hinting "Any form tool or spreadsheet that exports CSV will do."; it takes no other file while one is read.
   The help above it says how to export the file ("In Google Sheets, open the form's responses and choose File, Download, Comma-separated values."), that Conventioner reads the columns and answers to propose the market's dates, tiers and questions, that no one is imported, with the way on by the stored intake (": vendors apply on the market's page once applications open." or ": once the market is ready, you import the responses with Import responses, the next step at the top of the market's pages."), and "Nothing is written until you confirm, and the file is not kept."
   The way on names the phase rail's next step, never the Applications tab, which offers no import (E38/F04/S03).
   A file that is not a CSV export stays on Upload with "This file does not look like a CSV export. Download the responses again from Google Forms as .csv.", as at the import (E38/F15/S02).
   Only when a TypeSafe key is configured does the step add that column headings, and a description of the shape of their answers, are sent to TypeSafe, and that individual vendors' answers never leave Conventioner.
2. "Reading your columns…" shows while the proposal is made; there is no background job, and TypeSafe that has not answered in 5 seconds leaves the rules' answer, the row saying "Couldn't reach TypeSafe".
3. If the form's dates have no year, "Which year are these dates in?" opens on the year the stated weekdays fit and checks weekdays against the year typed ("Monday, November 17 is a Monday in 2025."), warning "…, so check the year." when they do not fit; "Use this year".
   A file with no dates asks nothing.
4. The year can be changed later with "change" beside the file summary.

## G4. Review and adjust the proposal

**Status:** Works (re-walked live on 2026-10-03 with the March 2026 export; nothing proposed required since E33/F02/S01, read from the code and `start-from-csv.spec.ts`).
Labels stay whole (bug 41), an option with commas in it stays one option (bug 27), and "Number of dates you want" may be left unasked, since the import does not require it of a file (bug 24).

The review is the import's own ledger, a table of "CSV column", "First answers" and "Becomes", in three bands (steps 1 to 3), with its marks and a side panel:

1. "What the file says about your plan": market dates, tiers best first, and "Most days one vendor may get" (an assignment rule, choosable).
   A value the plan already has is matched against it, and one that disagrees is settled with the import's own value fix, mapped to one of the plan's values or ignored; a plan that has values is never added to.
2. "Every column, in your file's order": each column's first answers and "answered by N of M", both read from the rows that are responses (a status your team typed into an empty row is none), and what it "Becomes": an essential question, "Your question" with a type, Required and kept options, or "Left out".
   The ledger changes only a column's fate, a question's type, whether it is required and which options to keep; labels, help text and order are the form builder's, after confirm.
   Every one of the organizer's questions is proposed not required; only the organizer ticks Required ([no question is inferred required](../rules/no-question-is-inferred-required.md)).
3. "Essential questions no column answers": each proposed as not asked, with why.
4. Rows with a yellow edge are worth a second look, each with its reason ("Could allow several answers", "Read as a column your team added", "Has options few applicants chose", "Couldn't reach TypeSafe" among them); none of them blocks confirm.
   Rare options are unticked by default ("chosen by 2 - keep?").
   Rare means fewer than 3 applicants, or, for a multi-select, under a set share of its answers, so an option chosen by 4 can be unticked too.
   A question the organizer made required, whose unticked options would leave applicants with no answer, says how many ("N applicants answered only options that are left out, so their applications would not import."); "Show all answers" lists every one and "Keep all" ticks them (bug 4).
5. The side panel, "Your proposal" ([`ProposalLedger.vue`](../../../front-end/src/components/csvProposal/ProposalLedger.vue)), sticks beside the ledger and counts "to check", then the rows by what they become (`proposalCounts` and `railLines` in [`csvProposal.ts`](../../../front-end/src/utils/csvProposal.ts)), adding up to the rows under "Every column, in your file's order": "say who applied and when" ("says who applied" when only the address column is there, "says when each applied" when only the timestamp column is), "answer essential questions", "become your questions" and "left out", each worded for one at one ("1 answers an essential question", "1 says who applied"); it says "Nothing is written until you confirm.", and holds "Create the form and plan" and "Cancel".

The ledger is the import's because the later import opens on the same one, so the organizer learns one screen, and file order is how they know their own Google Form; sorting the columns by what they become, or listing only the rows to check, were tried and not taken.

## G5. Confirm

**Status:** Works (re-walked live on 2026-10-03, as P2).
"Create the form and plan" writes everything in one update, or nothing, and lands on the form tab with the questions in file order and the plan's dates and tiers filled; add locations and sections by hand ([E3](planning.md#e3-locations), [E4](planning.md#e4-sections)) before the market can leave Draft.

Above the tab's steps a notice says once "Drafted from <file name>. No responses were imported." ([`DraftedFrom.vue`](../../../front-end/src/components/market/DraftedFrom.vue), T205).
On a Google Form market it goes on: "Import them with Import responses, the next step at the top of the market's pages, once the market is ready.", then "Still needed before the import:" and what the first import waits on, each as a link to where it is done ("Add a location, Add tables, Decide what reviewers read first, Decide the automatic rejections." after a file that named dates and tiers, Review setup's two leading to its step of the form tab); with nothing left it says only "Import them with Import responses, the next step at the top of the market's pages.".
The list is the first import's own ([H2a](import.md#h2a-first-import-everything-maps)), the move into Review's served blockers less the import's, linked by the same rule as the rail's: a link only for someone who may take its action, and a blocker offered none said as its message.
The file's name rides in the browser history entry the confirm pushes ([`draftedFrom.ts`](../../../front-end/src/utils/draftedFrom.ts)), never the address, and the entry's mark is cleared as it is read, so a reload, Back to it or a later visit to the tab shows no notice.

## G6. Cancel

**Status:** Works (walked live).
"Cancel" at any step writes nothing and returns to Market Setup; a market made from the dialog's "On my own Google Form" is then a Google Form draft to plan by hand ([P1](the-google-form-path.md#p1-csv-intake-form-built-by-hand)).

## The rules it obeys

- [No question is inferred required](../rules/no-question-is-inferred-required.md).
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md): only a draft's form is written.
- [The setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md): the file gives dates and tiers, and the market needs a location and tables before it leaves Draft.
- [What each role may do](../rules/what-each-role-may-do.md): the start is an Admin's.

Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
