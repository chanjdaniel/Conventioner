# Test data

## `google_forms_export.csv`

A real Google Forms response export with the people replaced.
231 applications to a five-day market, 31 columns, produced by `tests/fixtures/anonymise_form_export.py`.

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
Only identifying cells are rewritten, and every generated value is deterministic, so regenerating the fixture from the same source produces an identical file.

### Regenerating it

```
python tests/fixtures/anonymise_form_export.py <real-export.csv> tests/test_data/google_forms_export.csv
```

Do not commit the real export, and do not hand-edit the fixture: change the anonymiser instead, so the next person can tell what was done to the data.
