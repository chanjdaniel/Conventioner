---
id: E06/F03
title: Server resource hygiene
type: feature
status: in-progress
blocked_by: []
pr: []
---

## Outcome

The back end's use of connections, threads and file handles is bounded by what it serves, not by
how many requests it has served.

## Why now

A leak that is invisible in a single request and invisible in a unit test shows up as an
intermittent stall in a long-running suite, where it is diagnosed as flakiness and worked around.
E06/F01/S02 is that story; this feature is where the resource defects it turns up are fixed.
