# Test data

## `google_forms/`

Five real Google Form application exports, one per market, with the people replaced by `tests/fixtures/anonymise_form_export.py` (E24/F01/S01).
They are the only realistic responses this suite has, and the form started from a CSV is built and measured against them.

| File | Market days | Applications submitted | Rows | Columns |
|---|---|---|---|---|
| `fall-2023.csv` | Mon 20 - Fri 24 November 2023 | 19 September - 10 October 2023 | 294 | 12 |
| `spring-2024.csv` | Mon 25 - Thu 28 March 2024 | 28 January - 13 February 2024 | 361 | 30 |
| `spring-2025.csv` | Mon 17 - Fri 21 March 2025 | not recorded: this export has no timestamp column | 237 | 28 |
| `fall-2025.csv` | Mon 17 - Fri 21 November 2025 | 12 - 28 September 2025 | 237 | 30 |
| `spring-2026.csv` | Mon 23 - Fri 27 March 2026 | 26 January - 9 February 2026 | 250 | 35 |

All five are UBC Makers Market application forms.
Submission dates are read from the anonymised timestamps, which the anonymiser moves by a few hours, so a boundary day may be off by one.

### What was kept and what was invented

The header row is copied verbatim, newlines included: it is the organizer's question text, and it is what the proposal reads.
An answer, or one option inside a multi-select answer, is kept verbatim only when at least 3 distinct applicants gave it, counted by applicant email.
Everything else is invented in the same shape: same length, letter case, punctuation and digit count, an address for an email and a link for a link.
One applicant's email becomes the same invented address everywhere it appears, including other applicants' table-share answers.
Blanks, row order, the `TEST` row, organizer columns, duplicate columns and trailing empty columns are as the export had them.
Every timestamp moves by one offset.

The anonymiser refuses to write a file in which any source value of 4 or more characters that fewer than 3 applicants wrote appears, down to a single word inside a comment.
`tests/test_google_forms_corpus.py` pins each file's row count, header row and table-size answer counts.

### Regenerating them

```
python tests/fixtures/anonymise_form_export.py <real-export.csv> tests/test_data/google_forms/<name>.csv
```

The real exports live only on the maintainer's machine.
The output is deterministic, so regenerating from the same export produces an identical file.
Never commit a real export, and never hand-edit a copy: change the anonymiser, so the next person can tell what was done to the data.

## `google_forms_export.csv`

A real Google Forms response export with the people replaced.
231 applications to a five-day market, 31 columns, produced by an earlier version of `tests/fixtures/anonymise_form_export.py`.

### Why it exists

Three MVP blockers found on 2026-09-14 came from the **shape** of a real export rather than from logic.
Every CSV test in this suite wrote its own headers, and every one of them used a short single-line stem like `"Which days can you attend?"`.
That is why grid detection failing on a multi-line header survived to production: a fixture invented by the people who wrote the parser only tests what they already thought of.

The source file is 232 real applicants' names and email addresses, so it cannot be committed as it stands.
The anonymiser is committed beside the fixture so the transformation is auditable and re-runnable.

### What must survive anonymisation

These are the properties that actually caught bugs.
A regenerated fixture missing any of them is not doing its job, and `tests/test_real_export_shapes.py` asserts every one of them before it asserts anything else.

- **Grid question stems spanning several lines**, with the bracketed option last.
  This alone is the grid-detection blocker.
- **Timestamps in `M/D/YYYY H:MM:SS` with unpadded months and hours.**
  `datetime.fromisoformat` cannot read this, and text ordering puts `9/27/2025 9:04:01` after `9/27/2025 23:49:25`.
- **Grid cells holding a set of values, plus a `None` cell meaning "not available".**
  One cell carrying two facts is what the per-day tier question looks like.
- **Free-text answers that do not match the contract's vocabulary**: `Full table`, `Half table`, `Either` against `full` / `half` / `either`.
- **Duplicate column headers**, and a trailing empty column.
- **Roughly 232 rows**, so scale behaviour is exercised.

The header row is copied **verbatim**, newlines included.
Only identifying cells were rewritten, chosen by header words (`email`, `name`, `discord` and so on).

### Why it is not regenerated

The anonymiser has since changed what it keeps: a value stays only when at least 3 distinct applicants gave it, whatever its column is called (E24/F01/S01).
This file's source export is not among the ones that version was run on, so the file stays as the earlier version produced it.
Do not hand-edit it: a change it needs is a reason to replace it with one of the exports made by the current anonymiser.
Do not commit a real export.
