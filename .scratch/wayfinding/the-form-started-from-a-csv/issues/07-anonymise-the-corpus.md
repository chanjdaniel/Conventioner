# 07: Anonymise the corpus for reuse in tests

Type: task
Status: open
Blocked by: -

## Question

The five real exports in `.scratch/examples/markets/` are the only realistic Google Form responses we have, and they cannot be committed: they carry names, emails, Discord handles, business names, social links, Drive links to proof of affiliation (timetables), third parties' emails, organizer notes about named vendors, and per-second timestamps.
Produce anonymised copies that keep everything the proposal and the import read, and nothing that identifies anyone, so they can be committed and reused by e2e specs and back-end tests.

What must survive: the headers verbatim (the question text is the organizer's, and it is what the rules and a model read), the column order, grid grouping, blanks, the option-like answers as they are (tiers, days, table choice, clubs, yes/no, certifications) with their frequencies, multi-select joins, the shape of free text (length, and that some answers contain links or emails), the timestamps' ordering and range, and the messy rows (`TEST` rows, duplicate email columns, trailing empty columns).
What must not: any real name, email, handle, business name, URL, Drive id, phone number, or organizer note, and any free-text answer as written.

The answer records the method, where the anonymised files live, and a check that fails if a real value from the source files appears in them.
