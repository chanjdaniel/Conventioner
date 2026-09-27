---
id: E24/F03/S01
title: The proposal ledger
type: story
status: in-progress
blocked_by: [E24/F02/S01, E24/F02/S02]
pr: []
---

## What to build

A draft market has a flow, "Start from your Google Form", at its own address in the market frame, with steps Upload, Year, Review, Confirm, laid out as variant A of the prototype on `prototype/csv-proposal` ([05](../../../wayfinding/the-form-started-from-a-csv/issues/05-how-you-review-what-the-csv-proposes.md)).

- **Upload**: choose the CSV; one short "Reading your columns..." state while the proposal is made, no background job.
  When a TypeSafe key is configured (`GET /csv-proposal/typesafe`), one line says that column headings and a shape of their answers are sent to TypeSafe to help sort the columns, and that individual vendors' answers never leave Conventioner ([01](../../../wayfinding/the-form-started-from-a-csv/issues/01-what-hosted-jev-may-be-sent.md), F02/S03).
- **Year**: when the proposal has dates, a dialog (the product's dialog shell) asks which year they are in, opening on the year the weekdays fit ("Monday, November 17 is a Monday in 2025"); no fitting year opens on the current year with a warning; no dates, no dialog. The year stays changeable from the page's subtitle.
- **Review**: the ledger. A table in the file's order, as the import's ledger is: the CSV column (header clamped to two lines, a grid's columns named beneath its stem, answered-by count), its first answers, and what it becomes. Three shaded bands: what the file says about the plan (dates, tiers best first, most days one vendor may get, each with where it came from and how it meets the plan); every column; essential questions no column answers ("not asked", with why). A row to check has a yellow left edge and an attention chip with its reason; a left-out row's header is muted.
- **A sticky rail**: how many to check; how many columns become essential questions, your questions and left out; "Nothing is written until you confirm"; the confirm and Cancel.

This story renders the proposal as it came; correcting it is `S02`, confirming is `S03`.
Back, Cancel and leaving write nothing, and a reload keeps the organizer on the flow's address with the file to choose again (the file is never kept).

## Acceptance criteria

- [x] On each `F01` fixture, every column appears once, in file order, saying what it becomes; a grid is one row.
- [x] The rows to check are exactly those the proposal marked, and the rail's count matches them.
- [x] The year dialog opens on the fitting year for every fixture with dates, and does not open for one without.
- [x] Leaving at any step writes nothing: the market reads back unchanged.
- [x] It meets the design language at 1920x1080 and 1280x800: tokens and primitives only, no scroller of its own, the rail sticking under the market frame; the design-language lint lists its files.
- [x] Playwright: upload a fixture, answer the year, and see the ledger, from a draft market's address.
