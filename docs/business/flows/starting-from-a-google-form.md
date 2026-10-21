---
layer: business
kind: flow
describes:
  - front-end/src/views/StartFromCsvView.vue
verified: 2026-10-22
sources:
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
---

# Starting from a Google Form's responses

**Who:** the market's Admin or owner, while the market is a draft whose form has no questions of its own.
**Where they start:** the create-market dialog's "On my own Google Form" ([D2](creating-a-market.md#d2-create-a-market-that-starts-from-a-google-form)), or Market Setup; the flow is `/markets/<id>/start-from-csv` ([`StartFromCsvView.vue`](../../../front-end/src/views/StartFromCsvView.vue)), headed "Start from your Google Form".

The organizer uploads last year's (or this year's) responses, and the market's plan facts and questions are proposed from the file's columns for them to adjust.
Nothing is written until the organizer confirms, and the file is not stored ([the CSV proposal and start](../../implementation/modules/csv-proposal-and-start.md)).
The confirm also saves the import's column mapping, so the first import of the same file opens "Mapped when your form was started from this file."
Only column headings and the shape of their answers are sent to TypeSafe, and the upload step says so; no applicant's answer leaves Conventioner.
Covered by: `start-from-csv.spec.ts`, `where-a-form-starts.spec.ts`.

## G1. From the create-market dialog

**Status:** Works (walked live).
See [D2](creating-a-market.md#d2-create-a-market-that-starts-from-a-google-form).

## G2. From an existing draft

**Status:** Works (walked live).
Market Setup, How vendors apply, "Start from my Google Form's responses"; it works for either intake and leaves the intake choice as it is.
Disabled, with the reason, once the form has questions of its own: "This market's form already has questions of its own, so it can't be started from a Google Form's responses."
Past Draft, Market Setup is settled and offers no start; the flow's own address says "Only a draft market can be started from a Google Form's responses."

## G3. Upload and the year question

**Status:** Works (walked live).

1. Under "Upload your Google Form's responses", drop or choose the CSV (Google Sheets: File, Download, Comma-separated values).
2. If the form's dates have no year, "Which year are these dates in?" checks weekdays against the year ("Monday, November 17 is a Monday in 2025."); "Use this year".
3. The year can be changed later with "change" beside the file summary.

## G4. Review and adjust the proposal

**Status:** Works (re-walked live on 2026-10-03 with the March 2026 export; nothing proposed required since E33/F02/S01, read from the code and `start-from-csv.spec.ts`).
Labels stay whole (bug 41), an option with commas in it stays one option (bug 27), and "Number of dates you want" may be left unasked, since the import does not require it of a file (bug 24).

1. "What the file says about your plan": market dates, tiers best first, and "Most days one vendor may get" (an assignment rule, choosable).
2. "Every column, in your file's order": each column's first answers and what it "Becomes": an essential question, "Your question" with a type, Required and kept options, or "Left out".
   Every one of the organizer's questions is proposed not required; only the organizer ticks Required ([no question is inferred required](../rules/no-question-is-inferred-required.md)).
3. Rows with a yellow edge are worth a second look; rare options are unticked by default ("chosen by 2 - keep?").
   Rare means fewer than 3 applicants, or, for a multi-select, under a set share of its answers, so an option chosen by 4 can be unticked too.
   A question the organizer made required, whose unticked options would leave applicants with no answer, says how many ("N applicants answered only options that are left out, so their applications would not import."); "Show all answers" lists every one and "Keep all" ticks them (bug 4).
4. The side panel, "Your proposal", counts "to check", "answer essential questions", "become your questions" and "left out".

## G5. Confirm

**Status:** Works (re-walked live on 2026-10-03, as P2).
"Create the form and plan" writes everything in one update, or nothing, and lands on the form tab with the questions in file order and the plan's dates and tiers filled; add locations and sections by hand ([E3](planning.md#e3-locations), [E4](planning.md#e4-sections)) before the market can leave Draft.

## G6. Cancel

**Status:** Works (walked live).
"Cancel" at any step writes nothing and returns to Market Setup; a market made from the dialog's "On my own Google Form" is then a Google Form draft to plan by hand ([P1](the-google-form-path.md#p1-csv-intake-form-built-by-hand)).

## The rules it obeys

- [No question is inferred required](../rules/no-question-is-inferred-required.md).
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md): only a draft's form is written.
- [The setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md): the file gives dates and tiers, and the market needs a location and tables before it leaves Draft.
- [What each role may do](../rules/what-each-role-may-do.md): the start is an Admin's.

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
