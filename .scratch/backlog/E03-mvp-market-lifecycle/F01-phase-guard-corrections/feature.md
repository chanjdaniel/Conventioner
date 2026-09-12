---
id: E03/F01
title: Phase guard corrections
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

The phase guards judge a market on what it actually is, rather than on assumptions inherited from an intake path that no longer exists.

## Why now

`FormHasFieldsGuard` sits on the only forward edge out of `draft`, so anything it judges wrongly blocks every market.
It is wrong today, and the MVP path is the first thing to notice.
