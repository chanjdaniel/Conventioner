# E24 progress log

Working branch: `feat/e24-form-from-csv`.
Order: F01/S01 (done, PR #85), F02/S01, F02/S02, F02/S03, F03/S01, F03/S02, F03/S03, F04/S01, F04/S02.

## 2026-09-27

- F02/S01 started.
- Found: the anonymiser replaced every link with example.com, which hides the Drive upload links the `file` type rule reads. Fix: keep the parts of a link that 3 applicants' links share, then regenerate the five fixtures.
- F02/S01 built: `back-end/csv_proposal.py` and `POST /markets/<id>/csv-proposal`.
  The answer key passes: every kind, every type but the two clubs misses (marked "could allow several answers"), every required flag, and option recall 0.98 with none invented.
- F02/S01 reviewed and fixed. An upload column is proposed as text with a link, since the form has no file type (recorded on the story).
  The essential questions' order now lives once, in `essential_fields.ESSENTIAL_QUESTIONS`.
- F02/S02 built: the proposal's `plan` carries the dates, the fitting year, the tiers best first and the ceiling with its sentence.
  All five fixtures match ticket 03's answers, and a plan's own dates and tiers are matched rather than added to.
- F02/S02 reviewed and fixed: a plan date matches only when the file's weekday agrees, the ceiling's sentence stops at a line break, and the plan is read through `essential_fields`.
- F02/S03 built: `back-end/typesafe_client.py` (key, wording, one POST) and the asking in `csv_proposal._ask_typesafe`, with a 5 s deadline for all answers together.
  Live-checked once with synthetic text only: the HTTP shape works.
- F02/S03 reviewed and fixed: both questions now send exactly the state ticket 04 measured, and no value at all (a number range had leaked one applicant's answer).
  A header holding contact details is never sent.
- F03/S01 built: `/markets/:id/start-from-csv` (`StartFromCsvView`, `ProposalLedger`, `utils/csvProposal.ts`).
  `MarketFrame` now publishes its pinned height as `--market-frame-h`, declared in `base.css`, so a screen's own column can stick under it.
  Playwright walks all five fixtures; screenshots at 1920 and 1280 checked, and three layout faults fixed.
- F03/S01 reviewed and fixed: the refusal is served on the market (`csvStartRefusal`), the year note only states what is true, plan rows with a disagreement count as rows to check.
- F03/S02 built: the working copy (`draftFrom`, `correct`, `toggleOption`, `settle`, `takenBy` in `utils/csvProposal.ts`) and the ledger's controls.
  The import's value-fix control is now `components/ValueFixes.vue`, used by the import and the ledger alike.
  The server sends each question's options for both choice types, so one choice turned into several re-reads the answers.
- F02/S02 review fixes (options per reading, live not-asked, ceiling control, grid rows) committed.
- F03/S03 built: `back-end/csv_start.py` and `POST /markets/:id/csv-proposal/confirm`; the view confirms and lands on the Application Form tab.
  The seam holds end to end: the import of the same fixture restores every column and asks about no value.
  Found and fixed on the way: the import's rail did not count a tier grid as answering availability.
- F04/S01 built: the new-market dialog asks how to start; "I already have a Google Form" stores CSV intake and lands on Upload.
- F03/S03 reviewed and fixed: the plan keeps its own ceiling, a choice with nothing kept becomes a text question, value fixes are scoped to their targets, an unsettled plan disagreement is left for the import, and the confirm writes under the canonical filter.
- F04/S02 built: the "How vendors apply" card carries "Start from my Google Form's responses", disabled with the served reason.
  Found and fixed on the way: `parseMarketFromApi` dropped `csvStartRefusal`, so the flow's refusal had never reached the browser.
- F04 reviewed and fixed: the choice card is a primitive (`.choice-card`), the plan flushes before the flow opens, a plan ceiling is marked as the plan's, refusals say "Google Form's responses", and out-of-draft is tested.
- Full Playwright suite: 208 passed before the F04 fixes; the affected specs pass after.
- E24 complete: PR #86 opened to `dev`; every story marked done.
