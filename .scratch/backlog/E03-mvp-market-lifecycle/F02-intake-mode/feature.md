---
id: E03/F02
title: Intake mode on Market
type: feature
status: in-progress
blocked_by: []
pr: []
---

## Outcome

A market says how vendors reach it, and the public applicant surface serves only the markets that actually take applications online.
A CSV market answers a stranger exactly as a market that does not exist would, while its organizer still authors an application form and its vendors still check in on the day.

## Why now

MVP intake is a CSV import, which happens while the market sits in `applications_open`.
That is the same phase that opens the public application form, so today every MVP market has a live applicant surface it cannot honour: a stranger could apply and never hear anything, because MVP has no offers and no outcome emails.
The phase cannot tell the two intakes apart, which is the gap this feature fills.

## Decisions

Settled by [06: Intake mode on Market](../../wayfinding/v0-1-0/issues/06-intake-mode-semantics.md) (values, what is and is not gated, the single lookup helper, the freeze, the fail-closed default) and [07: What does the public slug route render?](../../wayfinding/v0-1-0/issues/07-public-slug-route-disposition.md) (a gated market answers as a nonexistent one does).
