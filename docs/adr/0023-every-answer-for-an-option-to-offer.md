---
layer: implementation
kind: adr
describes:
  - back-end/csv_proposal.py#every_reading
  - back-end/csv_start.py#_example_columns
  - back-end/datatypes.py#ExampleColumn
  - back-end/api/markets.py#leave_out_every_answer
  - back-end/api/markets.py#get_market_for_user
  - back-end/api/markets.py#_decorate_market_summary
  - back-end/api/markets.py#get_assigned_market
  - back-end/api/placements.py#run_assignment
verified: 2026-11-11
sources:
  - T191
  - T213
  - T263
status: accepted
---

# Every answer, for an option to offer

## Context

[ADR 0018](0018-what-of-an-applicants-answers-the-market-may-keep.md) let the market keep, outside an application, only the answers at least 3 applicants gave that name nobody.
So an answer one or two applicants gave is gone after [the start](../business/flows/starting-from-a-google-form.md), and an organizer adding an option to [a question made from the file](../business/flows/form-tab.md#f2-custom-questions) has to retype it from memory or from the sheet (T191's finding F08).
Daniel decided the option field offers every answer the file gave, one-offs included, less what `_names_someone` catches, for the filter-and-select list alone, while the defaults a type change fills stay the common answers (T191's Q05 1).
ADR 0018 says keeping these under a weaker filter is a new ADR that narrows it; this is that ADR.

## Decision

**A column whose answers are not mostly different also keeps every answer the file gave, less what `_names_someone` catches, and only someone who may change the form reads them, only while it can still change.**

- The start's confirm ([`back-end/csv_start.py`](../../back-end/csv_start.py)) writes them as `answers` beside `options` on the column (`_example_columns`, modelled in [`back-end/datatypes.py`](../../back-end/datatypes.py)), in both readings, values only, most chosen first: never a count, a row or who gave them (`every_reading`, in [`back-end/csv_proposal.py`](../../back-end/csv_proposal.py)).
- A column whose answers are mostly different has no `answers`: the Select reading holds at least `MOSTLY_DIFFERENT` (70%) as many answers as applicants who answered, and at least `MOSTLY_DIFFERENT_FROM` (20) answered.
  This is ADR 0018's own reason for refusing a whole column, since a column of who they are, or of their own sentences, is mostly different.
  The floor is there because every answer in a small file's choice column can differ by chance.
- The line stands in a measured gap, on the five synthetic exports and on the real exports on the PC, read by counts alone with no value printed or kept.
  Among columns at least 20 answered, read by their headings, every "what do you sell" column stands at 66.7% or under, no column stands between that and 75.1%, and the columns of free text, usernames, shop names and links stand above it.
  So a column that comes in above the line loses only the rare answers it would have offered, and its common options stay.
- Two cases pass the rule, and this ADR accepts both.
  **A small file:** under 20 answers the rule does not apply, so a Discord or shop-name column in a file that small is kept whole, less what `_names_someone` catches.
  **Repeated words:** the rule counts how different the answers are, not what they are, so a column of who they are in which about a third of the answers are the same words ("NA", say, typed into an optional question) falls under the line and is kept whole: 68 usernames and 32 "NA" pass, and 96 usernames and 4 "NA" do not.
- `SHARED_BY` no longer guards this reading, so what no pattern sees (a bare name, a shop's name, a postal code) can be kept when it sits in a column that is not mostly different.
  That is the weakening this ADR accepts, and Daniel's Q05 1 accepted it by name.
- The market read serves `answers` only when the reader's role passes `CHANGE_FORM` on this market's table and `application_form_lock_reason` is `None`.
- Everything else that answers with a market removes it, through `leave_out_every_answer` in [`back-end/api/markets.py`](../../back-end/api/markets.py): the read for anyone else, the Markets list, and the two assignment responses that dump the whole market (`get_assigned_market`, and `run_assignment` in [`back-end/api/placements.py`](../../back-end/api/placements.py)).
- No `answers` on a column always means the same: its common options are all there is, for a market started before this, a column of mostly different answers and a reader not served them alike.
- `kept_readings`, `SHARED_BY`, `OPTION_SHARE` and `options` do not change, so a type change, "Use the answers in your file" and "Add from your file" still fill only the common answers.

## Consequences

- Every answer adds 11 KB to 19 KB to a market, measured on the five synthetic exports, beside about 2 KB of common readings and well inside Mongo's document limit; the Markets list and every reader who is not served them stay as they were.
- They stay stored after the form locks, unread, and go when the market is deleted.
- A later change to an application does not change them, and there is no way to remove one answer from them.
- [ADR 0008](0008-each-write-names-what-it-changes.md) means no write takes a whole market back, so a read that leaves them out cannot overwrite what is stored.
- A market started before this gets no migration, since the file is gone; its options offer the common answers it kept.
- Keeping any more of an applicant's answers outside their application, or serving these to anyone else, is a new ADR that narrows this one.

## Considered and rejected

- **Keeping every column whole**: it stores whole columns of Discord usernames and shop names, which ADR 0018 refused, and no organizer turns those into a choice; it would also take 71 KB to 128 KB per market on the five exports.
- **An endpoint of its own**: the market read already knows the role and the lock, and the Questions tab already holds the market.
- **Only answers 2 or more applicants gave**: Q05's option c, which leaves out the one-off answers the finding asked for.
