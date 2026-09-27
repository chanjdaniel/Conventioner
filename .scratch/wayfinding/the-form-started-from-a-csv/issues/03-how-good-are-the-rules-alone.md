# 03: How good are the rules alone?

Type: task
Status: resolved
Blocked by: -

## Question

Build the rule-based floor as a throwaway script and score it against the corpus (`.scratch/examples/markets/`), with the right answer for each column written down by hand first.
Per column:

- **Is it a question at all**, or an organizer column (`Status`, `ED`, `Screening Notes`, `Column 1`), an empty trailing column, or Google's collected email duplicating an asked one?
- **Essential or custom**, and which essential: full name, email, available dates, tier preference (including the per-day grid), max dates, table choice.
- **Type** of a custom field, from the eight.
- **Required.**
- **Options**, including grid grouping and splitting comma-joined multi-select answers.

Per file, for the plan: the dates (from grid headers or from values), the tiers and their order (with "None" recognised as not a tier), and the ceiling on days per vendor where the header's text states one.

The rules read a column through the same view a model gets ([01](01-what-hosted-jev-may-be-sent.md)): the header, the values at least 3 applicants share, and the locally computed shape; score them on that view as well as on the whole column, since a gap between the two is what the privacy rule costs.

The answer is a scorecard: what the rules get right, what they get wrong and how often, and which misses look like judgement a model could supply.
It is what [04](04-does-a-model-beat-the-rules.md) has to beat and what [05](05-how-you-review-what-the-csv-proposes.md) has to let the organizer correct.

## Answer

Resolved 2026-09-27.
Scripts, answer key and output are on the local branch `research/rules-alone`, in `.scratch/wayfinding/the-form-started-from-a-csv/research/03-rules-alone/`.

**On this corpus the rules get every column's kind right and nearly everything else, but the corpus is one organizer's five forms, so the number that matters is what survives wording they were not written against.**
Rules that read values survive; rules that match header keywords did not, and were replaced.
What is left over is small and mostly not a model's to fix.

### The scorecard

135 columns across the five files, 74 of them custom fields, 13 of those choices with options.
Three views: the one [01](01-what-hosted-jev-may-be-sent.md) ruled, the same with options counted inside multi-select answers (the amendment below), and the whole column.

| | Ruled view | Plus options inside answers | Whole column |
|---|---|---|---|
| Kind (organizer, submitted at, email, which essential, custom) | 135/135 | 135/135 | 135/135 |
| Type of a custom field | 72/74 | 72/74 | 69/74 |
| Required | 73/73 | 73/73 | 73/73 |
| Options: precision / recall | 1.00 / 0.81 | 1.00 / 0.98 | 0.95 / 0.98 |
| Plan: dates, tiers and their order, ceiling | 5, 5, 5 of 5 | 5, 5, 5 of 5 | 5, 4, 5 of 5 |

- **The privacy view costs nothing and helps.** The whole column is worse: free-text answers that happen to hold commas read as multi-selects ("tabling experience", 4 files), and a `TEST` row became a tier. The threshold filters exactly that noise.
- **Required is weaker than it looks.** The file does not record which questions the Google Form required; the answer key inferred it from how many answered, as the rule does, so 73/73 says only that the fill-rate threshold (97% of responses) is sane. One column filled by 228 of 248 is ambiguous and not scored.
- **The year.** The weekdays in the date headers pin the year: exactly one year within two either side matches in all 5 files (within five, 3 of 5). The confirmation dialog can open on that year rather than a blank.

### The rules that held

All deterministic; every signal is a count computed locally from the column, so none needs a value sent anywhere.

- **Organizer columns**: left of `Timestamp`; a blank or `Column N` header; values that are review decisions (`Accepted`, `Rejected`, `TRUE`, `Y`), wherever the column sits.
- **Applicant email**: the first column that is all email addresses, near-unique and answered by everyone. **Duplicate**: a column whose emails equal the same row's (Google's collected address beside an asked one). **Table-share partner**: a column whose emails are *other* applicants'.
- **Full name**: capitalised words, two or more, near-unique. **Preferred name**: capitalised, one word, mostly unique.
- **Available dates and tier preference**: a grid whose brackets are dates (tiers when the answers are more than yes and no), or answers that are dates. Days joined with commas ("Monday, November 20th, Tuesday, ...") are split knowing a weekday is followed by its date, and an option like "Woven (crochet, knitting, etc)" knowing a parenthesis is not closed.
- **Tiers and their order**: the options of the tier grid other than "None", ordered by where they fall in joined answers (Google writes options in form order).
- **Max dates**: answers shaped "2 days". **Table choice**: options naming full and half.
- **Ceiling**: "up to / a maximum of / at most / no more than N days" in any header.
- **Custom type**: Drive upload links are `file`; all addresses `email`; one answer given by 97% or more `checkbox`; a few values covering 90% of answers `select`, or `multi_select` when joined answers contain standalone ones; otherwise `text`.

The first draft matched header keywords for names, emails and organizer columns and scored the same 135/135; header wordings other organizers plausibly use broke it (full name 3 of 9, email 2 of 7, table-share partner 0 of 4, organizer 6 of 15).
The value rules above pass all of those.

### What the rules still get wrong

| Miss | Seen | A model's to fix? |
|---|---|---|
| An organizer's free-text notes column placed after the questions, under a header like "Comments (internal)" | 4 of 4 wordings read as an optional text question; none in the corpus, where they sit left of `Timestamp` or say "Notes" | Possibly: the header is safe to send, and "is this a note about the applicant?" is a judgement |
| Ceiling phrased otherwise ("limited to 2 days", "3 days max") | 2 of 6 other wordings missed; none in the corpus | Possibly, for the same reason; or two more phrasings |
| `select` against `multi_select` when almost nobody chose two | 2 clubs columns | No: no view holds the evidence |
| An option fewer than 3 people chose | 1 ("No, I am not a UBC student") | No: withheld by the privacy rule, by construction |

So a file needs about one correction, and the organizer is the only one who can make half of them.

### Amending [01](01-what-hosted-jev-may-be-sent.md)

Two changes to the sending rule, recorded on that ticket:

- **Count applicants, not rows.** One applicant who submitted three times put a full name past "shared by 3". Threshold by distinct applicant email.
- **Count options inside a multi-select answer.** A combination ("Stickers, Prints, Keychains") is rarer than any of its options, so thresholding whole answers withheld common options ("Ceramic" chosen by 14). Each option sent is still one at least 3 applicants chose. Recall 0.81 to 0.98.
