---
layer: implementation
kind: testing
describes:
  - back-end/tests/test_data/google_forms/
  - back-end/tests/test_data/example_columns.csv
  - back-end/tests/fixtures/synthetic_form_exports.py
verified: 2026-10-30
sources:
  - wayfinding/real-market-readiness/map
  - wayfinding/the-form-started-from-a-csv/01
  - wayfinding/the-form-started-from-a-csv/07
  - E06/F04
  - E24/F01/S01
  - E38/F02/S01
  - T109
---

# Test data

The back-end suite's realistic data: five synthetic Google Form exports.
How the suites run is in [`docs/TESTING.md`](../../../docs/TESTING.md).

## [`google_forms/`](google_forms/)

Five Google Form application exports, every one made by [`tests/fixtures/synthetic_form_exports.py`](../fixtures/synthetic_form_exports.py).
No file comes from a real export, and a real export never becomes test data in any form, however it is changed first.
They are the realistic responses this suite has, and the form started from a CSV is built and measured against them.

| File | Market days | Applications submitted | Rows | Columns | The shape it keeps |
|---|---|---|---|---|---|
| `five-day-grid.csv` | Mon 20 - Fri 24 October 2025 | 18 August - 3 September 2025 | 237 | 30 | A five-day tier grid with a multi-line stem, a duplicate email column, organizer columns first and last |
| `team-status-column.csv` | Mon 20 - Fri 24 April 2026 | 23 February - 9 March 2026 | 250 | 35 | A team status column, four upload questions, a declined-affiliation option, a `TEST` row, a two-tier grid, a clubs question the proposal reads as one choice |
| `no-timestamp.csv` | Mon 19 - Fri 23 May 2025 | not recorded: this export has no timestamp column | 237 | 28 | No timestamp column, two organizer columns first, a ceiling of 2 days, multi-select answers that join a size with "Either" |
| `four-day-grid.csv` | Mon 22 - Thu 25 April 2024 | 25 February - 12 March 2024 | 361 | 30 | A four-day grid, separate social columns, a ceiling of 3 days, a clubs question the proposal reads as one choice, trailing empty columns, rows only the team filled in |
| `days-as-one-question.csv` | Mon 23 - Fri 27 October 2023 | 22 August - 12 September 2023 | 294 | 12 | No tier grid, the days as one comma-joined question, an organizer column after the timestamp |

### What the generator writes

Each file is described, header by header and column by column, in the generator, and written by it.
Every header is written for the file, the people come from the generator's pools of common names, every address is at a fixture domain, every link is at `example.com` but an upload's, and every other answer is made from the generator's word lists.
An upload keeps the Google Drive host, with an invented file id, because the proposal knows an upload by that host.
The organization is "Example College", the market "Example Makers Fair", the venue "Example Hall" with its "North Wing" and "South Wing", and the clubs "Example College <craft> Society"; `four-day-grid.csv` and `days-as-one-question.csv` also offer the invented abbreviation "ECVAS" as a club.
Each column states its counts exactly, never as weights, so a file's column kinds, options and import outcome are fixed by its description, whatever its seed draws.
236 of `five-day-grid.csv`'s 237 rows import, and the one refused has no full name.
245 of `team-status-column.csv`'s 250 rows import: one has no full name, one gave a timestamp for its email address, two applicants stopped after the first page, and the last row is the organizer's `TEST` submission.
235 of `no-timestamp.csv`'s 237 rows import, and the two refused gave something other than an address as their email: a name alone, and a name before their address.
355 of `four-day-grid.csv`'s 361 rows import: one applicant chose None on every day, three rows are an applicant sending the form a second time, and the last two are the team's own, a checkbox column filled in beside no response.
277 of `days-as-one-question.csv`'s 294 rows import: seven are blank lines the sheet kept, and ten are an applicant sending the form a second or third time.
`tests/test_google_forms_corpus.py` pins each file's row count, header row and table-size answer counts, and that the folder holds exactly the generator's files.

### Why the shapes matter

Three MVP blockers found on 2026-09-14 came from the **shape** of a real export rather than from logic.
Every CSV test in this suite wrote its own headers, and every one of them used a short single-line stem like `"Which days can you attend?"`.
That is why grid detection failing on a multi-line header survived to production: a fixture invented by the people who wrote the parser only tests what they already thought of.
So the generator writes what a Google Form writes, and `tests/test_form_export_shapes.py` asserts these properties before it asserts anything else, but for the duplicate and organizer columns, which the answer key in `tests/test_csv_proposal.py` holds:

- **Grid question stems spanning several lines**, with the bracketed option last.
  This alone is the grid-detection blocker.
- **Timestamps in `M/D/YYYY H:MM:SS` with unpadded months and hours.**
  `datetime.fromisoformat` cannot read this, and text ordering puts `8/27/2025 9:04:01` after `8/27/2025 23:49:25`.
- **Grid cells holding a set of values, plus a `None` cell meaning "not available".**
  One cell carrying two facts is what the per-day tier question looks like.
- **Free-text answers that do not match the contract's vocabulary**: `Full table`, `Half table`, `Either` against `full` / `half` / `either`.
- **Duplicate column headers**, and organizer columns first and last.
- **A market's number of rows**, so scale behaviour is exercised.

### Regenerating them

From `back-end/`:

```
python tests/fixtures/synthetic_form_exports.py
```

The output is the same bytes every time, written as Google Sheets exports: UTF-8 without a byte order mark, CRLF between records, LF inside a header cell, and a final newline.
`tests/test_synthetic_form_exports.py` fails when a committed file is not exactly what the generator makes.
Never hand-edit a file: change its description in the generator and run it again.
After a regeneration, run `python3 scripts/real_data_check.py staged` on the machine that holds the real exports: a random draw can pair a given and a family name into a real applicant's, and only that machine can tell.

## [`example_columns.csv`](example_columns.csv)

Forty invented applications, no export behind them, shaped to pin what a market started from a file keeps of it (E38/F02/S01; `tests/test_csv_start.py`, and the E2E that starts a market from it).
It holds a multi-select ("What do you sell?") with a joined answer carrying a link that 3 applicants gave and two options fewer than 3 chose, a select ("Booth size"), unique handles, and the two columns a team adds ("Status", a select of verdicts, and "Notes", holding a phone number 3 rows share).
Every address is at `example.com` and the one phone number is in the reserved `555-0100` to `555-0199` range.

## Superseded

- The corpus was first made from real exports by a script that invented the people but kept each form's question text and every answer three applicants shared (wayfinding/the-form-started-from-a-csv/01); the script is retired, and every file is generated, so the question text and the answers are invented too (T109).
