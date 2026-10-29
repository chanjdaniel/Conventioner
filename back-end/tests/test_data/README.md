---
layer: implementation
kind: testing
describes:
  - back-end/tests/test_data/google_forms/
  - back-end/tests/fixtures/synthetic_form_exports.py
  - back-end/tests/fixtures/anonymise_form_export.py
verified: 2026-10-30
sources:
  - wayfinding/real-market-readiness/map
  - wayfinding/the-form-started-from-a-csv/01
  - wayfinding/the-form-started-from-a-csv/07
  - E06/F04
  - E24/F01/S01
---

# Test data

The back-end suite's realistic data: Google Form exports, one synthetic and four real ones with the people replaced.
How the suites run is in [`docs/TESTING.md`](../../../docs/TESTING.md).

## [`google_forms/`](google_forms/)

Five Google Form application exports.
`five-day-grid.csv` is synthetic, made by [`tests/fixtures/synthetic_form_exports.py`](../fixtures/synthetic_form_exports.py) (below).
The other four are real application exports, one per market, with the people replaced by [`tests/fixtures/anonymise_form_export.py`](../fixtures/anonymise_form_export.py) (E24/F01/S01).
They are the realistic responses this suite has, and the form started from a CSV is built and measured against them.

| File | Market days | Applications submitted | Rows | Columns |
|---|---|---|---|---|
| `fall-2023.csv` | Mon 20 - Fri 24 November 2023 | 19 September - 10 October 2023 | 294 | 12 |
| `spring-2024.csv` | Mon 25 - Thu 28 March 2024 | 28 January - 13 February 2024 | 361 | 30 |
| `spring-2025.csv` | Mon 17 - Fri 21 March 2025 | not recorded: this export has no timestamp column | 237 | 28 |
| `five-day-grid.csv` | Mon 20 - Fri 24 October 2025 | 18 August - 3 September 2025 | 237 | 30 |
| `spring-2026.csv` | Mon 23 - Fri 27 March 2026 | 26 January - 9 February 2026 | 250 | 35 |

The four anonymised files are real markets' application forms.
Their submission dates are read from the anonymised timestamps, which the anonymiser moves by a few hours, so a boundary day may be off by one.

### What the anonymiser kept and what it invented

The header row is copied verbatim, newlines included: it is the organizer's question text, and it is what the proposal reads.
An answer, or one option inside a multi-select answer, is kept verbatim only when at least 3 distinct applicants gave it, counted by applicant email, and it holds no email address, link, handle or phone number, however many share it.
That is the rule for what the CSV proposal may treat as shared, so the fixtures keep exactly what the proposal reads; it is decided by the count, never by a list of header words, which is what let a column be missed before.
Everything else is invented in the same shape: same length, letter case, punctuation and digit count, an address for an email, a link for a link, and a fictional 555-0100 to 555-0199 number for a phone number, so the output passes the git hooks' real-data check.
A link keeps its scheme and each part at least 3 applicants' links share, so a Drive upload still reads `https://drive.google.com/open?id=` and an Instagram link still names Instagram, while the file id, the handle and anyone's own site are invented.
One applicant's email becomes the same invented address everywhere it appears, including other applicants' table-share answers.
Blanks, row order, the `TEST` row, organizer columns, duplicate columns and trailing empty columns are as the export had them.
Every timestamp moves by one offset.

The anonymiser refuses to write a file in which any source value of 4 or more characters that fewer than 3 applicants wrote appears, down to a single word inside a comment.
`tests/test_google_forms_corpus.py` pins each file's row count, header row and table-size answer counts.

### Regenerating the anonymised files

```
python tests/fixtures/anonymise_form_export.py <real-export.csv> tests/test_data/google_forms/<name>.csv
```

The real exports live only on the maintainer's machine.
The output is deterministic, so regenerating from the same export produces an identical file.
Never commit a real export, and never hand-edit a copy: change the anonymiser, so the next person can tell what was done to the data.

### The synthetic files

`five-day-grid.csv` is described, header by header and column by column, in [`tests/fixtures/synthetic_form_exports.py`](../fixtures/synthetic_form_exports.py), and written by it.
Nothing in it comes from a real export: every header is written for the file, the people come from the generator's pools of common names, every address and link is at a fixture domain (an upload keeps the Google Drive host, with an invented file id, because the proposal knows an upload by that host), and every other answer is made from the generator's word lists.
The organization is "Example College", the market "Example Makers Fair", and the clubs "Example College <craft> Society".
Each column states its counts, so the file keeps its predecessor's rows, columns, column kinds, options and import outcome: 236 of its 237 rows import, and the one refused has no full name.

#### Why the shapes matter

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

#### Regenerating them

```
python tests/fixtures/synthetic_form_exports.py
```

The output is the same bytes every time, written as Google Sheets exports: UTF-8 without a byte order mark, CRLF between records, LF inside a header cell, and a final newline.
`tests/test_synthetic_form_exports.py` fails when a committed file is not exactly what the generator makes.
Never hand-edit a file: change its description in the generator and run it again.

## Superseded

- One anonymiser regenerating the older single export, `google_forms_export.csv`, as well as the five (wayfinding/the-form-started-from-a-csv/07): its source export was not among the five, and it has since been removed; its tests read `five-day-grid.csv`.
