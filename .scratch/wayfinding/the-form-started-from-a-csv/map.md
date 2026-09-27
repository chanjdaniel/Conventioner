# Map: The form started from a CSV

Status: open

Charted 2026-09-27, from Topic 4 of the [2026-09-26 brain dump](../../brain-dump/2026-09-26.md).

## Destination

An organizer who already collects applications with their own Google Form uploads its responses CSV and gets a market that is set up from it: the plan's dates and tiers, an application form that asks what their form asked, and the mapping their later CSV import will use - each proposed, and theirs once they have reviewed it.
The way is clear when nothing remains to decide before that can be built, including a measured go or no-go on whether a model (hosted Jev or a local lookalike) earns a place beside the rules.
An epic in `.scratch/backlog/` is the by-product.

## Notes

**Where this came from.**
The brain dump's Jev spike: can Jev turn a past vendor CSV into a form in our format?
Charting widened it: the same CSV states the plan, and saying what each column is also maps the import, so the organizer should answer "what is this column?" once.

**Skills every session should consult.**
`grilling` and `domain-modeling` by default; `prototype` and `research` where the ticket says so.
`AGENTS.md` is authoritative on the sharp edges this map touches: **Intake Mode**, **Essential Form Fields**, **Application Form Lock**, **Organization Deletion and the Import Chain** (the form amendment) and **The Solver Reads Applications**.
`back-end/csv_import.py` is the import this sits in front of: grid grouping, value matching, the saved mapping and its restore.

**The corpus.**
Five real Makers Market Google Form exports are in `.scratch/examples/markets/` (2023 to March 2026, 237-361 rows, 12-35 columns).
They hold vendors' names, emails and links, so the folder is git-ignored and must never be committed, pasted into a ticket, or sent anywhere a ticket has not cleared ([01](issues/01-what-hosted-jev-may-be-sent.md)).
Tickets quote headers and value counts, never rows; a test fixture is an anonymised copy of a file's shape ([07](issues/07-anonymise-the-corpus.md)).

**This map is planning.**
Resolving a ticket produces a decision, not a deliverable.
The two measuring tickets build throwaway scripts; their numbers are the deliverable, and the scripts go to a `research/` branch.

### Settled while charting

These frame every ticket and are not open for re-litigation without redrawing the destination.

- **Who it is for.** A CSV-intake organizer, whose Google Form is the real form and who today retypes its questions into ours so the import has somewhere to put each column.
  The CSV is the one they will import.
  A form-intake organizer seeding this year's form from last year's responses benefits only if nothing extra is needed for them.
- **The words.** **Form started from a CSV** and **CSV import** entered `CONTEXT.md`; "draft form" is avoided, because Draft is a phase.
- **One answer, two uses.** Deciding what each column is shapes the form and becomes that file's saved import mapping; the import of the same file opens already mapped.
- **The CSV proposes the plan too**, as far as it states it: the market dates, the tiers and their order, and the ceiling on days per vendor where the form's text states one.
  It never states locations, sections or table counts; the organizer adds those on Market Setup as today.
  In practice the CSV is for the upcoming market, whose plan the Google Form was built from; the corpus is past years' files only because that is what exists.
- **The organizer's own plan wins.** The CSV fills only what the plan leaves empty; where the plan has values, the CSV's are matched against them, as the import matches values today, and a disagreement is shown, never merged silently.
- **The year is asked, not guessed.** Headers carry `[Monday, November 17]` and no year; after upload a confirmation dialog asks the organizer which year the dates are in.
- **The form asks what the Google Form asked.** An essential question no column answers (every file in the corpus lacks section preference) is proposed as not asked, which is what the import would otherwise refuse on.
- **Where it starts.** At market creation ("I already have a Google Form", which also sets the intake mode to CSV), and as an action on a draft market's Market Setup; the exact placement is the prototype's ([05](issues/05-how-you-review-what-the-csv-proposes.md)).
- **The floor is rules.** Labels, keys, order, options from distinct values, grid grouping, dates and tiers read from headers and values: all deterministic.
  A model is added only where it measurably beats them.

## Decisions so far

<!-- one line per resolved ticket -->

- [01: What may hosted Jev be sent?](issues/01-what-hosted-jev-may-be-sent.md):
  **one column per call, never a row, and only values at least 3 applicants share (counted as people, and per option inside a multi-select; most common first, up to about 10), else a locally computed shape.**
  A risk assessment of the corpus puts every identifying column (names, emails, handles, Drive links, free text, organizer notes) past that threshold by construction; the same rule binds a local model. The upload step says what leaves; the key is optional and a failure falls back to the rules.
- [02: What can Jev and its local lookalikes actually do?](issues/02-what-jev-and-its-lookalikes-can-do.md):
  **hosted Jev is fast, cheap and batches a column's questions in one call, but keeps a perpetual right to derive telemetry from what it is sent; the Jev lookalikes are near chance zero-shot.**
  The local candidates for the measurement are established zero-shot classifiers (deberta-v3 NLI, GLiClass, GLiNER2), not Laya or JEV-CPU.
- [03: How good are the rules alone?](issues/03-how-good-are-the-rules-alone.md):
  **every column's kind right on the corpus and about one correction per file; rules that read values survive other organizers' wording, header keywords did not.**
  The privacy view scores better than the whole column. The leftovers are organizer notes after the questions and a ceiling in unusual prose (possibly a model's), and single-versus-multi choice and rare options (only the organizer's). The weekdays pin the year.

## Not yet specified

- **A form that already has fields.** Starting from a CSV on a form the organizer has begun: replace, merge by label, or refuse? Depends on how the review looks ([05](issues/05-how-you-review-what-the-csv-proposes.md)).
- **Waiting on a model.** If a model earns its place, does the proposal wait on the request or run as a background job the page watches? Roughly 1 s per question on CPU times 4 questions times 30 columns is minutes; hosted is faster. Depends on [04](issues/04-does-a-model-beat-the-rules.md).
- **A form-intake organizer's entry point**, if [05](issues/05-how-you-review-what-the-csv-proposes.md) leaves them one at all.

## Out of scope

- **Carrying review decisions over.** Every file in the corpus has an organizer column (`Status`, `ED`, `Accepted? (Y/N)`, `Screening Notes`) from when the responses sheet doubled as the review tracker. A relic, not a workflow to support: the proposal recognises these columns as not questions and leaves them out, and nothing imports them as approvals.
- **Proposing priority rules.** "Which clubs are you a member of?" looks like a priority target, but priority is the organizer's judgement and the CSV does not state it; the column becomes a custom field a rule can target later.
- **Writing text.** Help text and cleaner labels would need a generative model; the proposal keeps the Google Form's own wording.
