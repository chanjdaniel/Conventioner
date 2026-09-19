---
id: E10/F03
title: Assignment lives in its phase
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

Running the solver is an operation inside the `assignment` phase, repeatable there and unavailable
past it, and its results are a screen the organizer opens rather than a place they are pushed to.

## Why now

`Assign` is gated only on `assignmentOptionsComplete` and never on phase, so it is enabled on a
published market whose check-in page is serving table numbers.
`Done` posts a transition invalid from the phase the organizer is standing in and fails with a raw
enum error - the report's blocker B2.

## Hard constraint

**`S02` must not ship before manual placement edits do**
([ticket 08](../../../wayfinding/readable-journey/issues/08-where-a-manual-placement-lives.md)).
Freezing the solver with no way to hand-fix a placement leaves an organizer whose vendors drop out
on the morning of the market with archiving a running market as their only move.
