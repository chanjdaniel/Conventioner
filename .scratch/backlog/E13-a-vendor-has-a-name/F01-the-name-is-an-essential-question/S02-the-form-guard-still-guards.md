---
id: E13/F01/S02
title: The form guard still guards
type: story
status: in-progress
blocked_by: []
pr: [70]
---

## What to build

`FormHasFieldsGuard` fails only when `custom_fields == 0 and essential_questions == 0`.
A name asked unconditionally means the essential count is never zero, so **the guard could never
fail again**.

Its docstring states what it protects:

> A question with nothing to offer is not asked, so a market with no dates, no tiers and fewer than
> two sections genuinely asks nothing, and is genuinely blocked.

That is the last thing stopping an organizer opening applications on a market with nothing to
assign - collecting applications for an event that cannot place anyone.

**The guard counts only plan-derived essential questions**, excluding identity, so it keeps meaning
exactly what it means today.

## Acceptance criteria

- [ ] A market with no dates, no tiers and fewer than two sections is still blocked from
      `-> applications_open`, with the message it gives today.
- [ ] A market with dates is not blocked.
- [ ] A test pins the blocked case, so the next unconditional essential question cannot silently
      disable the guard again.

## Notes

The honest shape is to rename this guard for what it protects - the market plan offers something to
apply for - since "does the form ask anything" was always a proxy for that.
Deliberately not taken here: rewriting a precondition is a bigger act than this epic should carry,
and the two are not in conflict.
