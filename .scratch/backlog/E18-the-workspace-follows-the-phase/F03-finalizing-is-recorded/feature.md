---
id: E18/F03
title: Finalizing is recorded
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

The product can say whether a market's application form has been opened to applicants, and when.

## Why now

The field that means this exists, is threaded through the market API, and is read by two front-end components - and **nothing in the back end ever assigns it a value**.
It is only ever carried from the stored form into the response, so it is null on every market in the product.

Settled in [ticket 03](../../../wayfinding/the-order-of-the-work/issues/03-what-finalized-means.md): leaving draft is finalizing, so there is no new act for an organizer to discover, and no new guard - the existing one already refuses a market whose plan offers nothing and whose form therefore asks nothing.
Only the stamp was missing.

## Stories

- `S01` - finalizing is recorded.
