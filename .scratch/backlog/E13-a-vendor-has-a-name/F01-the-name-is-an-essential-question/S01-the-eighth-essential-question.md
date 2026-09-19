---
id: E13/F01/S01
title: The eighth essential question
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

`essential_full_name`, label "Full name", in `back-end/essential_fields.py` and mirrored in
`front-end/src/utils/essentialFields.ts`.

- **One field.** Never first + last. Both name columns in the Fall 2025 export are whole names, so a
  required first-name field would receive `Ana Rivera` for all 232 rows.
- **Asked unconditionally.** `asked_essential_keys()` gates every other question on the plan
  offering something; this one is gated on nothing, because identity does not depend on the plan.
  It is therefore the first key in that function with no condition - say so in a comment, because it
  reads as an oversight otherwise.
- **Required by the applicant validator**, on save.
- **Not in `SOLVER_RELEVANT_KEYS`.** Correcting a spelling must not invalidate a review; the comment
  on that tuple already asserts exactly this.
- **`REQUIRED_ESSENTIAL_KEYS` separates from `SOLVER_RELEVANT_KEYS`.** It is currently derived
  (`tuple(key for key in SOLVER_RELEVANT_KEYS if key != TABLE_SHARE_EMAIL_KEY)`), which defines
  required-ness as solver-relevance-minus-one. That stops being true.
- **Not declarable unasked.** `UNASKABLE_ESSENTIAL_KEYS` admits only rankings; unchanged.
- **An import target.** `import_targets` in `csv_import.py` builds from a hardcoded
  `essential_order` tuple; the key goes in it, so `Full Legal Name` maps straight across.

## Acceptance criteria

- [ ] A market with no dates, no tiers and no sections still asks for a name.
- [ ] An applicant save with no name is refused, naming the question as the form asked it.
- [ ] A stored application with no name still assigns - `_solver_vendor` must not demand it.
      This is what makes the change need no migration, and a test should pin it.
- [ ] Changing a name does not invalidate an approved review.
- [ ] The CSV importer offers "Full name" as a target, and the Fall 2025 fixture maps to it.
- [ ] `docs/schema.d.ts` regenerated via `python generate_market_schema.py`.
- [ ] The front-end mirror in `essentialFields.ts` agrees, and its test pins that.
