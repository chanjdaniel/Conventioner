---
id: E34
title: Reviewing as a team
type: epic
status: done
blocked_by: [E31]
pr: []
---

## Outcome

A team of organizers reviews one market at the same time without duplicating or overwriting each other's work.
Every verdict says who gave it, and an application can wait on a follow-up, with someone responsible for it.
Besides the one-by-one review, a bulk view shows every application and its status and lets a reviewer act on a selection.
An assignment rule's "All others" reads every answer the way an organizer means it.

## Why now

The [2026-10-19 brain dump](../../brain-dump/2026-10-19.md): the organizers review as a team, asked for a follow-up state in place of Skip, and asked for a bulk view.
Today a verdict is an unconditional write that records nobody, each reviewer's queue is their own browser's copy, and a verdict needs ADMIN, which also moves the market's phase.
Settled in the same day's grilling (decisions 9-11, 17, 21-23, 25, 29).

**One decision here reverses an earlier one.**
[real-market-readiness 04](../../wayfinding/real-market-readiness/issues/04-what-a-reviewer-needs-to-decide.md) chose triage with no bulk action at all, so that no application is approved without being looked at.
The organizers who ran the November 2026 review asked for bulk; `F04` answers 04's concern with a selection the reviewer ticks and a confirmation naming the count, never "everything matching the filter", and with `E33/F03`'s automatic rejections taking the clear-cut cases first.

Feature work, so it waits for the November 2026 market window to close (2026-11-21).

## Features

- `F01` - every verdict says who gave it.
- `F02` - needs follow-up.
- `F03` - reviewers do not collide.
- `F04` - the bulk view.
- `F05` - "All others" reads every answer.

## Order inside this epic

`F01` first: `F02`, `F03` and `E33/F03` all record a giver.
`F03` before `F04/S02`, whose bulk verdict skips held and changed applications.
`F04/S01` opens the vendor drawer, `E35/F01/S01`.
`F05` is independent of the rest.
