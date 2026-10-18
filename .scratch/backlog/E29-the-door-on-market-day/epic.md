---
id: E29
title: The door on market day
type: epic
status: in-progress
blocked_by: []
pr: []
---

## Outcome

On each day of the market, the organizer at the door sees every vendor expected that day, by name and table, who has arrived and who has not, and can check a vendor in themselves.

## Why now

The [2026-10-09 rehearsal](../../../docs/MVP_TEST_RUN_2026-10-09.md) named it the one thing the real market still needs ([known gap 3](../../../docs/MVP_KNOWN_GAPS.md#3-attendance-cannot-say-who-is-missing)), and the [2026-10-18 final dry run](../../../docs/MVP_TEST_RUN_2026-10-18.md) kept it standing.
With about 80 vendors a day in the real room, a list of who checked in, by email, cannot answer who is missing.

Decided with the organizer on 2026-10-18, in conversation rather than a Wayfinder map, because nothing about it was open beyond two questions:

- **Who may check a vendor in: EDITOR and up**, the bar every other market write sets; door volunteers are added as editors. Every organizer check-in records who made it.
- **The door uses a laptop, and sometimes a phone**: laptop-first, and the page must work at 390px.
- A vendor checking in on a day that is not theirs is not refused in code, but no screen suggests it (fixed in [#97](https://github.com/chanjdaniel/Conventioner/pull/97)).

## Features

- `F01` - Attendance knows who is missing, and an organizer can check a vendor in.
