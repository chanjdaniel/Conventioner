# 03: What replaces the column-indexed priority system?

Type: grilling
Status: resolved
Blocked by: none

## Question

Priority decides who gets placed first when demand exceeds tables: `sort_vendors` orders vendors by `(num_assignments, priority_scores, date_flexibility)`, and `priority_scores` comes from the organizer's rules applied in order.

It was expressed entirely in CSV columns.
`PriorityObject` carried `col_name_idx`, `data_type` and `sorting_order`; each index had to be in range of `enum_priority_order`, itself required to hold one entry per column in `col_names`.
Deleting `col_names` deletes the addressing scheme the whole configuration is built on.

### What was actually there

- **The UI promises far more than the solver delivers.** `ElementAssignmentPriority.vue` renders an ordered table of rules, each with a column, a data type (`String` / `Number` / `Enum` / `Contains` / `Does not contain`) and a sorting order, constrained by a `dataTypeSorting` map.
- **The solver reads none of it.** Zero occurrences of `data_type` or `sorting_order` in `assignment/`. `_calculate_priority_score` handles one case: look up `enum_priority_order[col_name_idx]`, score by the value's index, and append `0` if that list is empty.
  So a rule configured as `Number` / `Ascending` scores every vendor identically and **does nothing, silently**.
- **The model duplicates what `FormField` already knows.** A `FormField` carries `key`, `type` and `options`, so `data_type` restates `type` and `enum_priority_order` is a parallel array of what is essentially a permutation of `options`, addressed by column position.

## Answer

**A priority rule is an ordered rule naming a target and an ordering, where the ordering's shape is derived from the target's type.**

### What a rule addresses

**A custom `FormField` key, or one of a small set of built-in application attributes** (`submitted_at`, `application_type`, and potentially the applicant's email domain).

Most real criteria - returning vendor, category, local - are questions the organizer asked on their own form, so field keys carry them.
But **"first come, first served" is probably the most common tiebreaker there is**, and no form question can supply it: it lives on `Application.submitted_at`.
A field-only design would force organizers to fake it with a "what time is it" question.

Rejected: a closed vocabulary defined by us. Priority is exactly where markets differ from one another, so the organizer must be able to name their own questions.

### `data_type` is deleted, not ported

A rule names a target; how to order it **follows from that target's type**.
A `select` orders by a permutation of its `options`; a `number` ascending or descending; a `date` earliest or latest first; a `checkbox` true-first or false-first.

Keeping a separate `data_type` lets an organizer declare `Number` on a text field and get silence - which is exactly today's behaviour.
Deriving it makes the invalid state unrepresentable rather than merely discouraged.

### `enum_priority_order` is deleted

The ordering moves **onto the rule itself, as a permutation of the target field's `options`**.
Today it is a parallel array indexed by column position with one entry required per column - the arrangement behind the `IndexError` trap `AGENTS.md` records and the e2e seeds got wrong.
Storing it on the rule removes the index arithmetic entirely.

Keep the existing **`<All others>`** token so an organizer need not enumerate every value.

### Supported orderings in MVP

**Ordered options, number, date, and boolean** - all derived from `FormField.type`.

`Contains` and `Does not contain` are dropped: they are *predicates*, not orderings. They sort into two buckets, which a checkbox field expresses more honestly.
Rejected also: implementing only ordered options (what works today), because it would rule out first-come-first-served.

### Migration

**Nothing to migrate**, subject to verification against the actual database rather than the repo.
No market has ever shipped, there is no deployment, and the only priority configurations found are in `tests/`.
The same verification is owed for `source_data` when E02 deletes it - do them together.

### Constraint handed downstream

**`submitted_at` must hold real submission time, not import time.**
It is `Optional`, and if every CSV-imported row receives the *import* timestamp they are all identical and first-come-first-served silently does nothing for CSV markets - the same silent no-op found three times already in this area.

A Google Forms export carries a `Timestamp` column as its first field.
**Ticket 04 owns how the organizer maps it**; this ticket owns the requirement that it be mapped to something real.

## Consequences

- `PriorityObject` loses `col_name_idx`, `data_type` and `sorting_order`, gaining a target reference and an ordering.
- `SetupObject.enum_priority_order` is deleted.
- `ElementAssignmentPriority.vue` is rebuilt: the column dropdown becomes a target picker over the market's own form fields plus an "About the application" group, and the data-type dropdown disappears.
- Two of the five data types the UI advertised are removed rather than implemented.
