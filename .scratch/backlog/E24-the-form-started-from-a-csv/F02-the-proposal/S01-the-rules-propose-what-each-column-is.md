---
id: E24/F02/S01
title: The rules propose what each column is
type: story
status: in-progress
blocked_by: [E24/F01/S01]
pr: []
---

## What to build

Given a draft market and a CSV, the server proposes, for every column in file order, what it becomes: who applied (submitted at, applicant email), an essential question and which, a question of the organizer's own, or left out, and why.
For the organizer's own questions it proposes a type from the eight, whether it is required, its options, and its label, help text and key.
Nothing is written.

The rules are the value-based ones measured in [03](../../../wayfinding/the-form-started-from-a-csv/issues/03-how-good-are-the-rules-alone.md) (its answer lists them; the throwaway script is on the `research/rules-alone` branch):

- a column is read through the privacy view of [01](../../../wayfinding/the-form-started-from-a-csv/issues/01-what-hosted-jev-may-be-sent.md), counting distinct applicants, with multi-select answers counted per option; the view scored better than the whole column;
- an organizer's column is found by position (left of Timestamp), a blank or "Column N" header, or review-decision values;
- names, emails, the duplicate collected email and the table-share partner are found by what their values look like, never by header words;
- grids are grouped as the import groups them, and comma-joined answers split knowing a weekday is followed by its date and a parenthesis is not closed;
- a choice question's options come from the whole file, which never leaves the server, each carrying its count and marked rare when fewer than 3 chose it (off by default, [05](../../../wayfinding/the-form-started-from-a-csv/issues/05-how-you-review-what-the-csv-proposes.md));
- label, help text and key follow [06](../../../wayfinding/the-form-started-from-a-csv/issues/06-one-answer-two-uses.md) (first line, or first sentence past 120 characters; the rest verbatim as help text; a slug capped at 40 characters);
- an essential question no column answers is proposed as not asked.

**Decided while building (2026-09-27):** "a type from the eight" was wrong: the application form accepts seven, and no file type exists in it or in the applicant form.
A Google Forms upload column is proposed as a text question asking for a link, marked `upload` and "check this", since the export holds a Drive link either way.
A choice question lists its common options and then rare ones up to 20 in all, and counts the rest; a checkbox question's "Other" answers run to hundreds.

A guess carries a "check this" reason: could allow several answers; read as an organizer's column; an option chosen by fewer than 3.

## Acceptance criteria

- [x] On the five fixtures of `F01`, the proposal matches the hand-written answers of [03](../../../wayfinding/the-form-started-from-a-csv/issues/03-how-good-are-the-rules-alone.md): every column's kind, 72 of 74 custom types, every required flag, options with recall of at least 0.98 and no option invented; the answer key is committed as a test.
- [x] The two known misses (a clubs question read as one choice) come back marked "check this", not silently wrong.
- [x] A market that is not a draft, or whose form already has custom fields, is refused with the reason ([05](../../../wayfinding/the-form-started-from-a-csv/issues/05-how-you-review-what-the-csv-proposes.md)).
- [x] Nothing is stored: not the file, not the proposal.
- [x] One module owns reading a CSV into a proposal, beside the import's own module and sharing its grid grouping and header collapsing rather than copying them.
