---
id: E04/F02
title: The docs match the product
type: feature
status: in-progress
blocked_by: []
pr: []
---

## Outcome

The two documents a newcomer actually follows - how to start the stack, and how to run the tests -
describe the product as it is after the intake and solver changes. The stale checklist that competes
with this backlog is gone.

## Why now

A release tag asserts that the documentation is true. These two are not.

`STARTUP.md` still lists an API module E02 deleted, and still tells the reader to create a user
through an endpoint that produces a user who cannot log in. `TESTING.md` claims the market pipeline
suite exercises the full product flow, which E04/F01 establishes is not so.

A deploy or setup doc that is wrong is worse than one that is missing, because it will be trusted.
