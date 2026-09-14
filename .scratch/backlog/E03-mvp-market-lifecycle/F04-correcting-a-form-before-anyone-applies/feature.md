---
id: E03/F04
title: Correcting a form before anyone has applied
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

An organizer who opened applications too early can return the market to draft and fix its form,
while nobody has applied.

## Why now

The form is editable only in `draft`, import is permitted only in `applications_open`, and no
transition returned to `draft`. So every custom field had to be anticipated before ever seeing the
import screen, and one click froze the form permanently - which is why a reviewer sees an email
address and nothing else.

Decided by
[ticket 05](../../../wayfinding/real-market-readiness/issues/05-how-custom-fields-reach-a-frozen-form.md).

## Shape

- Add `applications_open -> draft` to `VALID_TRANSITIONS`, guarded on **no application existing**.
- `PUT /markets/<id>/application-form` stays the form's only writer. Creating fields inside the
  import wizard was rejected: submission is gated to `applications_open`, so the D9 count is
  race-free only in `draft`.
- The import wizard gets a dead end for an unmapped column the organizer wants to keep: "this column
  has nowhere to go - return the market to draft to add a field for it."

## Unblocks

`E08/F04` (review by triage) cannot be built until this is, because an essential-only form makes
every triage card identical.
