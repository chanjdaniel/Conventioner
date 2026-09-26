---
id: E21/F03
title: Each write names what it changes
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

No client sends the whole market to change one part of it, and no write can leave a market in a state its creation refuses.

## Why now

`PUT /markets/:id` takes the client's entire copy of the market and stores it.
The server survives that by re-applying every field it owns (phase, form, assignment, intake mode after draft, and more), added one "a stale client copy overwrote X" bug at a time.
Under the back-end-is-truth model settled in [the-market-frame ticket 03](../../../wayfinding/the-market-frame/issues/03-one-market-every-surface-reads.md), a whole-document write is a client claiming to be the truth.

Grilling also found that the same PUT moves a market to no organization, or to an organization id that does not exist, and answers 200 to both, which `POST /markets` refuses.

[Ticket 04](../../../wayfinding/the-market-frame/issues/04-what-becomes-of-the-whole-market-put.md) settled the rest: the PUT is deleted, a market's organization is fixed at creation, a rename is its own write and only in draft, and no two markets share a public address.

## Stories

- `S01` - the market PUT refuses an organization that creation would refuse. Startable now.
- `S02` - the plan saves only the plan.
- `S03` - a public address belongs to one market. Startable now.
- `S04` - renaming is its own write, and only while the market is a draft.
- `S05` - a market belongs to one organization, for good.
- `S06` - the whole-market PUT is gone.
