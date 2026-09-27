# 05: How do you review what the CSV proposes?

Type: prototype
Status: resolved
Blocked by: 03

## Question

The proposal is a set of guesses, and `csv_import.suggested_mapping` holds that making an organizer audit our guesses is worse than letting them map a column themselves.
What makes reviewing this proposal worth it rather than worse, and what does it look like?

Candidates to put side by side:

- **A column ledger**, like the import's: one row per column, saying what it became (a plan fact, an essential question, a custom field, left out), with the uncertain ones marked.
- **The result**: the plan cards and the form builder, filled in, with what was guessed flagged where it sits.
- **Both, in order**: the ledger to settle the columns, then the ordinary screens to edit the result.

It also settles: the year confirmation dialog after upload, how a disagreement with an existing plan is shown, where "I already have a Google Form" sits in market creation and on a draft's Market Setup, and whether nothing is written until one confirm.
How wrong the rules are ([03](03-how-good-are-the-rules-alone.md)) decides how much review there needs to be: about one correction per file, of four kinds (an organizer's notes read as a question, a choice that should allow several answers, an option fewer than 3 people chose, a ceiling the prose hid).
Two of those only the organizer can make, so the review has to make them easy to spot and to fix.
It also settles where the ceiling on days per vendor shows: it is an assignment rule, not a plan card, and the rules find it in the headers.
The year dialog can open on the one year the stated weekdays fit.

## Settled so far (grilling, 2026-09-27)

Round 1, all as recommended:

1. **Both, in order**: a proposal ledger that reuses the import ledger's row anatomy (column, first answers, what it becomes), then the organizer lands on the Application Form tab to edit the result.
2. **One confirm, nothing written before it.** The proposal is a working copy; confirm writes the plan facts, the form, the ceiling and the saved import mapping together; cancel or leaving writes nothing.
3. **A guess is marked "check this" with a one-line reason** (Jev below 0.8 or unavailable; could allow several answers; read as an organizer's column; rare options), with a count at the top. Unchecked rows never block confirm.
4. **Rare options are shown, flagged "chosen by N - keep?", off by default.** What a column is comes from the privacy view; its options list comes from the whole file, which never leaves.
5. **The year** is asked in an `AppDialog` after upload, opening on the one year the weekdays fit; no dates, no dialog; no fitting year opens on the current year with a warning.
6. **Two entry points.** The new-market dialog offers "I already have a Google Form", which sets intake mode to CSV and lands on the upload step. A draft's Market Setup carries "Start from my Google Form's responses" on the "How vendors apply" card, and that one leaves intake mode alone, which is the form-intake organizer's entry at no extra cost.
7. **Only on a form with no custom fields**; otherwise the action is disabled with the reason.
8. **The ceiling is a plan-facts row** at the top of the ledger beside dates and tiers, labelled as an assignment rule, written on confirm.
9. **A disagreement with the plan reuses the import's inline value fix** (map to one of the plan's values, or ignore), which becomes the saved value resolutions; the plan is never added to.
10. **A UI prototype of the ledger follows** before the epic.

Round 2, all as recommended:

11. **The ledger edits fate, type, required and which rare options to keep**; label, help text and order stay with the form builder.
12. **Its own address in the market frame**, `/markets/:id/start-from-csv`, steps Upload, Year, Review, Confirm; Back leaves without writing.
13. **The file is discarded**; only the mapping is stored. No new retention of vendor PII.
14. **Abandoning after creation leaves an ordinary empty draft** with CSV intake; the Market Setup action takes the organizer back in.
15. **One short "Reading your columns..." state**, no background job; past the 5 s timeout the rules stand and the rows say "check this: couldn't reach TypeSafe". The upload step's disclosure line shows only when a key is configured.

## Answer

Resolved 2026-09-27.
Prototype on the local branch `prototype/csv-proposal` (1cf5f41d): `/markets/:id/start-from-csv?variant=A|B|C`, invented data.

**The review is the import's own ledger, in the file's order, with the plan facts on top: variant A.**
One row per column (CSV column, first answers, what it becomes), then one confirm, then the Application Form tab.
The fifteen settled points above are the behaviour; the layout is:

- **The ledger is a table in file order**, as the import's is: header (two lines, then clamped), the grid's columns named beneath its stem, answered-by count; the first answers; and "Becomes" as a menu of fates (who applied, an essential question, your question, left out), with the essential's name, or the custom field's type menu and Required on one line beneath it, and its options as checkboxes with counts.
- **Three bands, each a shaded section row**: what the file says about your plan (dates, tiers best first, most days one vendor may get, each with where it came from and how it meets the plan); every column in the file's order; essential questions no column answers ("not asked", with why).
- **A row to check** carries a yellow left edge and an attention chip with its reason; a left-out row's header is muted.
- **A sticky rail** beside the table: the count to check, how many columns become essential questions, your questions and left out, "Nothing is written until you confirm", then Create the form and plan, and Cancel.
- Why A over sections by fate (B) and a focus list (C): the later import opens on the same ledger, so the organizer learns one screen, and file order is how they know their own Google Form.

Built by [E24](../../../backlog/E24-the-form-started-from-a-csv/epic.md).
