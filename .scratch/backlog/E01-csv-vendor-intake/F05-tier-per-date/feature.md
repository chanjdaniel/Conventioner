---
id: E01/F05
title: Tier preference is per date
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

An applicant says which tiers they would accept **on each date**, and the solver honours that.

## Why now

Tier is a hard filter *and it sets the price*. One flat set for the whole application means a vendor
who offered Gold on Monday and Bronze on Friday can be placed at Gold on Friday and charged for it.
Real forms ask this per day and promise "the highest tier available among the selections made" per
day, in writing, to the applicant.

Decided by
[ticket 02](../../../wayfinding/real-market-readiness/issues/02-how-a-market-expresses-tier-per-day.md).

## Shape

`essential_tier_preference` keeps its key and becomes date -> list. Availability stays its own
answer; validation refuses a ticked date with no tiers. A plain migration converts stored flat
answers and strips any priority rule targeting the key.

## Stories

- **S01** - the contract and the validator: per-date shape, and a ticked date with no tiers is refused.
- **S02** - the applicant form and its preview ask tiers per date.
- **S03** - the solver filters per date, and the rule builder stops offering tier as a priority target.

## Verified - the real file, untouched, end to end

`tests/test_data/google_forms_export.csv` as the form exported it, through the real endpoints:

| step | result |
|---|---|
| inspect | 31 columns, the 5-day grid detected as one question |
| required targets | section ranking gone (E01/F06); availability supplied by the tier grid |
| unmatched values | 5 - one per date heading, resolved once each, not per row |
| preview | **232 of 232 valid, 0 failures** |
| import | **232 created** |
| assign | 333 assignments, 250/250 tables, 205 vendors |
| **placements at a tier the vendor did not accept on that date** | **0 of 333** |

A sample stored answer, which is the case the change exists for:
`{"2025-11-17": ["Gold"], "2025-11-18": ["Bronze"], "2025-11-19": ["Silver"], ...}`. A union would
have let that vendor be placed at Gold on Wednesday and charged for it.

572 existing applications migrated.

## Four things this turned up

**The day grid answers BOTH questions.** One grid, whose bracketed option is the date and whose cell
is the tier list - the reverse of every other grid, where a non-empty cell means "this option was
picked". So availability is read from it rather than demanding a second column the form never had.
The two answers are still stored separately and still have to agree; this is what makes them agree
by construction.

**A tier grid has two vocabularies in it.** The keys are dates spelled as the form's column headings
("Monday, November 17") and the values are tier names. Each half matches against its own offering,
so the organizer resolves five date headings once each instead of meeting one opaque value per row.

**`unserved_required` was two copies of one rule.** `preview_values` and `import_applications` each
decided which required targets a mapping serves, and only one of them learned that a tier grid
answers availability. The other refused the exact shape real forms have. Now one function.

**"2 days" is not a number.** The real form's max-dates dropdown reads "2 days", so every row failed
validation. Normalised at the boundary like the timestamp, and deliberately narrow: the number must
start the value, so "about two" is still refused rather than guessed at.

## One consequence that needed no code

Dropping tier as a priority-rule target turned out to be already true: `custom_answers` excludes
every `essential_` key, so the solver could never read one and the rule builder only ever offered
custom fields plus the two built-ins. Verified rather than assumed.
