---
id: E24/F02/S03
title: Hosted Jev settles what the rules cannot
type: story
status: in-progress
blocked_by: [E24/F02/S01]
pr: []
---

## What to build

When `TYPESAFE_API_KEY` is configured, the proposal asks hosted Jev two questions the rules leave, and only where the rules have nothing to say:

- is a column after the form's questions one of the form's questions, or a column the market's staff added to record their review (the wording that measured best, "C" in [04](../../../wayfinding/the-form-started-from-a-csv/issues/04-does-a-model-beat-the-rules.md));
- what ceiling on days per vendor a header's prose states, if any.

An answer is used only at 0.8 or above; below it, the row keeps the rules' answer and is marked "check this".

What may be sent is [01](../../../wayfinding/the-form-started-from-a-csv/issues/01-what-hosted-jev-may-be-sent.md)'s rule and nothing more: one column per call, never a row; the header; values at least 3 distinct applicants share, per option in a multi-select, most common first, up to about 10, none holding an email, URL, handle or phone number; else a locally computed shape.
The upload step says so in one line, shown only when a key is configured.

The key is optional and never a boot requirement: read through the one place that decides whether a variable holds a secret, so a blank or published placeholder is unset; unset means the rules alone.
A failure, a rate limit or a wait past 5 s leaves the rules' answer and marks the row "check this: couldn't reach TypeSafe".
The key is already in the back end's local template; the compose template and the release docs gain it as optional.

**Decided while building (2026-09-27):** TypeSafe is called over plain HTTP (`POST /v1/systemone`, model pinned to `jev-1.13.0`, the one the threshold was measured on), not through `typesafe-sdk`: the SDK is pre-1.0 and needs a newer pydantic than the back end runs.
The team question is asked of the optional free-text questions after the form's last certain column; the ceiling question of the first heading sentence that names a number of days the rule did not read.
`GET /csv-proposal/typesafe` tells the upload step whether to show its one line.

## Acceptance criteria

- [x] With no key, the proposal is exactly `S01`'s and `S02`'s, and nothing is sent anywhere.
- [x] With a key, a test with a stubbed client asserts what each call carries: one column, no row, no value fewer than 3 applicants share, no email or link; and that only the two questions are asked.
- [x] An answer below 0.8, an error and a timeout each leave the rules' answer and a "check this" reason; none fails the proposal.
- [x] The boot check is unchanged: a deployment without the key boots, and a placeholder key counts as none.
- [x] Both env templates ship the key blank, and the release docs list it as optional with what it sends.
