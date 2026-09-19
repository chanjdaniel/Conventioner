---
id: E10
title: One lifecycle model
type: epic
status: in-progress
blocked_by: []
pr: []
---

## Outcome

The organizer navigates a market's lifecycle in one place, and the setup screens stop being a second
model of it.

## Why now

The product shows two parallel, unconnected models of where a market is and what to do next, and
they disagree in a way that breaks the happy path: `Assign` does not move the phase, so `Done` posts
a transition that is invalid from the phase the organizer is standing in, and fails with two
internal enum values and circular advice.

Resolved by
[readable-journey ticket 01](../../wayfinding/readable-journey/issues/01-one-lifecycle-model.md):
the phase is the model, the wizard is a plan editor, and every lifecycle control leaves the wizard
for a rail below the market header.
Read that answer before taking any story here; each of the four features is one part of it.

## Sequencing

`F01` waits on
[ticket 06](../../wayfinding/readable-journey/issues/06-where-the-check-in-url-lives.md), the
prototype that draws the rail - two parts of 01's answer are prose that ought to be pictures.
`F02`, `F03` and `F04` do not wait on anything.

`F03` carries a hard constraint: **freezing `Assign` past the `assignment` phase must not ship
before manual placement edits do**, or an organizer whose vendors drop out on the morning of the
market has no move but to archive a running market.
[Ticket 08](../../wayfinding/readable-journey/issues/08-where-a-manual-placement-lives.md) is
resolved and the work is `E11-placements-you-can-change/`, so `F03/S02` waits on that epic rather
than on a decision.
`F03/S01` does not wait on it.
