# 01: What may hosted Jev be sent?

Type: grilling
Status: resolved
Blocked by: -

## Question

Hosted Jev is in the running beside local models, and a question to it carries a text state: a column's header plus some of its values.
Those values are vendors' names, emails, Discord handles and links.
What is the most a hosted call may carry?

- Headers only (then Jev judges a column by its question text alone).
- Headers plus a handful of distinct values, with values that look like personal data (emails, URLs, handles, anything in a name-shaped column) withheld.
- Headers plus distinct values of low-cardinality columns only (a column with 5 distinct values across 250 rows is options, not identities).

And what follows from the answer: whether sending to TypeSafe needs the organizer's say-so or a line in the privacy notice, whether it is on by default, and whether a deployment can switch it off.
What TypeSafe keeps ([02](02-what-jev-and-its-lookalikes-can-do.md)): no fixed retention period, a perpetual right to derive and process telemetry including classifications, and zero data retention only for enterprise customers.

The measurement ([04](04-does-a-model-beat-the-rules.md)) runs hosted Jev under whatever boundary this settles, so the corpus never leaves the machine under a looser one.

## Answer

Resolved 2026-09-27.

**A call is one column, never a row, and carries only values several applicants share.**
Values from different columns never meet in one request, so no request can hold "enough of a row to identify someone"; the risk is in single values, and the rule below is built for them.

### The sending rule

Applied to each column on its own:

1. **Drop** any value that contains an email, a URL, an `@handle` or a phone number. Kept as a belt to step 2's braces.
2. **Keep** only values at least **3** applicants share, so no value sent points at fewer than three people.
3. **Send** up to about 10 of what is left: the most common, in a fixed order. With step 2 in place a random pick adds no privacy, the most common answers represent the column best, and a fixed sample keeps the measurement ([04](04-does-a-model-beat-the-rules.md)) repeatable.
4. **Otherwise send a shape**, computed locally, holding no value: how many answers, how many distinct, and what they look like ("all links", "numbers from 6 to 150", "prose, around 80 characters").

The same rule applies to a local model, so the measurement compares like with like and the proposal reads a column the same way whichever model runs.

### Why that rule: the risk assessment

Every column in the corpus was profiled for uniqueness and for emails, URLs, handles, Drive links and phone numbers, in aggregate, with no value printed.

| Kind of data | Columns in the corpus | Uniqueness | Risk of sending a value |
|---|---|---|---|
| Direct identifiers | full and preferred name, email (twice), Discord, business name, Instagram / Twitter / website / socials, per-second timestamp | 0.91-1.00 | Critical: one value is one person. Only 7-16 per column carry an `@`, so no pattern catches names, business names or bare handles. |
| Drive links to documents | proof of UBC affiliation ("e.g. Workday timetable"), proof of membership, 100-120 portfolio links per file | 1.00 | Critical: the link may grant access to a timetable with a student number on it. |
| Third parties | "anyone you would like to share a table with?" (31-73 values are someone else's email) | 0.91-0.93 | Critical: data about a person who never applied. |
| Free text | tabling experience, additional comments | 0.97-0.99 | High: comments hold emails (up to 3), phone numbers (1-4) and stories naming people. |
| Organizer notes | `Column 1`, free text in `Accepted? (Y/N)` | ~1.00 | High: an organizer's judgement about one named vendor. |
| Mixed | "What will you be selling?" | 0.53 | Medium: the common half ("Stickers") is safe, the one-of-a-kind half describes one maker. |
| Options | tiers per day, max days, table choice, student status, clubs, certifications | 0.00-0.03 | Low, except a rare option ("VASA" once, "No, I am not a UBC student" twice), which step 2 withholds. |

Uniqueness is the signal that holds, where patterns do not: every critical and high column is near-unique, so the rule sends it as a header and a shape, by construction, with no list of column kinds to maintain.

### What follows

- **The organizer is told, once, on the upload step**: column headings and common answers are sent to TypeSafe to help sort the columns, and individual vendors' answers never leave Conventioner. No consent checkbox: it would train organizers to click through a box about data that identifies nobody. The product has no privacy notice today.
- **Hosted Jev is optional.** `TYPESAFE_API_KEY`, read through `configured_secret()` so a blank or published placeholder counts as unset; unset means rules only, and it is never a boot requirement, since nothing it defends is served (AGENTS.md, Security Hardening). Both env templates ship it blank.
- **A failure is never an error.** Jev down, rate-limited, slower than about 5 s, or its pre-1.0 SDK changing: that upload falls back to the rules for the columns affected, and the review marks them uncertain. Hosted Jev can only ever make a column less uncertain.

### Amended by [03](03-how-good-are-the-rules-alone.md)

Measuring the rules exposed two faults in step 2, fixed here:

- **"3 applicants" counts people, not rows.** One applicant who submitted three times put their full name past the threshold. A value is counted once per distinct applicant email.
- **In a multi-select answer, the options are what is counted**, not the joined answer: each option sent is one at least 3 applicants chose. A combination is rarer than its parts, so counting whole answers withheld common options.

Built by [E24](../../../backlog/E24-the-form-started-from-a-csv/epic.md).
