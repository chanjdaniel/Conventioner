---
id: E03/F01/S01
title: FormHasFieldsGuard counts essential questions
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

An organizer whose application form consists only of the five essential questions can advance their market from `draft` to `applications_open`.

Today they cannot.
`FormHasFieldsGuard` passes only when `applicationForm.fields` is non-empty, but the essential questions are purpose-built components deliberately kept out of that list, so a form that asks every question the solver reads still counts as empty.
The organizer's only workaround is to add a custom field they do not want.

The guard should judge whether the form asks anything at all, essential questions included.

## Acceptance criteria

- [ ] A market whose `applicationForm` has no custom fields but a non-empty essential offering advances `draft -> applications_open`
- [ ] A market whose form asks genuinely nothing is still blocked, with a message that tells the organizer what to do
- [ ] The blocker message no longer implies that adding a *custom* field is the only remedy
- [ ] Existing behaviour for forms that do have custom fields is unchanged
- [ ] Backend tests cover: essential-only form, custom-only form, both, and neither
- [ ] An e2e story walks an organizer from market creation to `applications_open` without adding a custom field

## Notes

The guard registry validates itself at import (`_validate_registry()`), and `AGENTS.md` is explicit that adding or removing a precondition is a one-file edit in `back-end/guards.py` - the endpoint and `BlockerPanel.vue` are generic over the wire shape and must stay that way.
This story changes a guard's logic, not the registry's shape, so neither should need touching.

Determining what "the essential offering is non-empty" means precisely is part of this story: `essential_fields.py` derives the offering live from the market plan until it is frozen, so a market with no dates and no sections configured yet may legitimately have an empty offering.
