---
id: E01/F05
title: Tier preference is per date
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

An applicant says which tiers they would accept **on each date**, and the solver honours that.

## Why now

Tier is a hard filter *and it sets the price*. One flat set for the whole application means a vendor
who offered Gold on Monday and Bronze on Friday can be placed at Gold on Friday and charged for it.
Real forms ask this per day and promise "the highest tier available among the selections made" per
day, in writing, to the applicant.

Decided by
[ticket 02](../../../wayfinding/real-market-readiness/issues/02-how-a-market-expresses-tier-per-day.md).

## Shape

`essential_tier_preference` keeps its key and becomes date -> list. Availability stays its own
answer; validation refuses a ticked date with no tiers. A plain migration converts stored flat
answers and strips any priority rule targeting the key.

## Stories

- **S01** - the contract and the validator: per-date shape, and a ticked date with no tiers is refused.
- **S02** - the applicant form and its preview ask tiers per date.
- **S03** - the solver filters per date, and the rule builder stops offering tier as a priority target.
