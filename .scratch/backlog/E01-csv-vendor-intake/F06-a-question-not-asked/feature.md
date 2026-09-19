---
id: E01/F06
title: A required question can be declared not asked
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

An organizer whose intake cannot answer a required question can say so, and a default is stored -
for rankings only.

## Why now

Tier is a property of a section, so a market offering three tiers needs three sections, which makes
section preference required - and a Google Form that never mentioned sections cannot answer it. The
import is blocked outright: Preview never enables.

Decided by
[ticket 03](../../../wayfinding/real-market-readiness/issues/03-when-the-csv-cannot-answer.md).

## Shape

- Offerable for **rankings only** - section preference, table type preference. Never for available
  dates, tier preference or table choice, where a default invents a commitment the applicant never
  made.
- That limit is **one rule beside `asked_essential_keys()`**, not a flag per question.
- Recorded **on the market's application form**, beside `essentialOptions`, so it holds for the
  native form too and stays visible to the single statement of requiredness.

## Verified

Against the real `tests/test_data/google_forms_export.csv` on a market with three tiers (and so
three sections, and so a required section ranking):

- required import targets **before**: `applicant_email, available_dates, max_dates, table_choice,
  tier_preference, section_ranking`
- declare section preference unasked (in draft) -> **200**
- required import targets **after**: the same, minus `section_ranking`. **B3 closed.**
- declaring a *constraint* unasked -> **400**: *"'essential_tier_preference' cannot be left
  unasked. Only a preference ordering may be..."*

In the UI: the switch lives in the form builder's essential-questions panel, works both ways, and
survives a reload.

## Two things this turned up

**`import_targets` held a second copy of the requiredness rule.** It tested `options.dates`,
`len(options.sections) > 1` and so on by hand rather than calling `asked_essential_keys`, so it
could not see a market's declaration - and would have drifted from the applicant validator and the
solver the moment either moved. It now reads the one rule. This is precisely the drift
`essential_fields.py`'s docstring warns about, sitting in the codebase already.

**A form with no custom fields could not be saved at all.** `_normalized_application_form` raised
"must include at least one field", which contradicts the rule `AGENTS.md` states: *a form is its
custom fields PLUS the essential questions the plan asks, and either half alone is a form*. It made
a market whose intake is the essential questions - the common case - unable to record anything about
its own form. Relaxed; whether a form asks enough to OPEN applications is `FormHasFieldsGuard`'s
decision, and it counts both halves.

## Where the control lives, and why it moved

First built into the import wizard, which was wrong and the live walk caught it: the wizard only
runs in `applications_open`, where the form is locked, so the button always 409'd. The declaration
is a change to the form, so it is made in the form builder (draft). The wizard points at it, the
same shape as the unmapped-column dead end.
