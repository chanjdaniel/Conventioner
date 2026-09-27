# 07: Anonymise the corpus for reuse in tests

Type: task
Status: resolved
Blocked by: -

## Question

The five real exports in `.scratch/examples/markets/` are the only realistic Google Form responses we have, and they cannot be committed: they carry names, emails, Discord handles, business names, social links, Drive links to proof of affiliation (timetables), third parties' emails, organizer notes about named vendors, and per-second timestamps.
Produce anonymised copies that keep everything the proposal and the import read, and nothing that identifies anyone, so they can be committed and reused by e2e specs and back-end tests.

What must survive: the headers verbatim (the question text is the organizer's, and it is what the rules and a model read), the column order, grid grouping, blanks, the option-like answers as they are (tiers, days, table choice, clubs, yes/no, certifications) with their frequencies, multi-select joins, the shape of free text (length, and that some answers contain links or emails), the timestamps' ordering and range, and the messy rows (`TEST` rows, duplicate email columns, trailing empty columns).
What must not: any real name, email, handle, business name, URL, Drive id, phone number, or organizer note, and any free-text answer as written.

The answer records the method, where the anonymised files live, and a check that fails if a real value from the source files appears in them.

## Answer

Resolved 2026-09-27: the method is settled here, and producing the files is a story in the epic, since it is build work.

`back-end/tests/test_data/google_forms_export.csv` already exists, made by `back-end/tests/fixtures/anonymise_form_export.py` from one export: headers verbatim, people replaced by a deterministic pick. It rewrites the clubs and selling answers too, covers one file, and has no leak check.

1. **Extend that script**, deterministic as it is, and regenerate the existing fixture with it so `test_real_export_shapes.py` keeps passing. One anonymiser, not two.
2. **The privacy rule of [01](01-what-hosted-jev-may-be-sent.md) decides what is kept.** Headers verbatim; any value, or option inside a multi-select answer, that at least 3 distinct applicants share stays verbatim; everything else becomes an invented value of the same shape (a name for a name, an address for an email, a link for a link, prose of similar length for prose); blanks stay blank. Decided by the count, not by a list of header words, which is what let a column be missed before.
3. **Timestamps move by one fixed offset**, keeping their order and spacing; row count and order, `TEST` rows, duplicate email columns and trailing empty columns are kept as they are.
4. **The check is a refusal at generation**: the script writes nothing if any source value of 4 or more characters that fewer than 3 applicants share appears anywhere in its output. The real files never reach CI, so CI asserts the fixtures' shape (rows, header rows, value frequencies).
5. **All five live in `back-end/tests/test_data/google_forms/`**, the README listing each file's source market and date range and no names; back-end tests and e2e specs read them from there.

Built by [E24](../../../backlog/E24-the-form-started-from-a-csv/epic.md).
