---
id: E06/F03/S01
title: The back end makes one MongoDB client per process, not one per request
type: story
status: done
blocked_by: []
pr: [#66]
---

## What to build

Serving requests does not accumulate MongoDB connection pools.

## What was wrong

A `MongoClient` is a connection pool with its own background monitoring threads, and nothing in
this application closes one. Most API modules called `get_database()` once at import, which is
fine. `api/applicants.py` called it **inside four request handlers** - including
`get_public_application_form`, the public applicant form fetch - so every public applicant request
built a fresh pool and leaked it for the life of the process.

It is called before the market is even looked up, so a request for a market that does not exist
leaks one too.

### Measured, not inferred

Against a running stack, reading `db.serverStatus().connections.current` from MongoDB itself:

| | before | after |
| --- | --- | --- |
| baseline | 28 | 9 |
| +10 applicant requests | 48 | 9 |
| +30 applicant requests | 60 | 9 |
| +30 requests to `/markets` (one client at import) | no growth | no growth |

The control matters: `/markets` never moved the number, which is what localises the defect to the
per-request call sites rather than to request handling in general.

The baseline falling from 28 to 9 is the same fix reaching further than intended: the ten modules
that each built a client at import now share one.

## What was done

`get_database()` memoizes the default client per database name, behind a lock. A caller that passes
`server_selection_timeout_ms` still gets a fresh client, because the only such caller is the
startup migration probe, which wants a short-lived time-bounded handle and runs once.

Memoizing at that seam rather than hoisting the four calls to module level keeps `get_database` as
the function the applicant tests patch, and makes the leak structurally impossible rather than
fixed at four call sites someone can add a fifth to.

## Acceptance criteria

- [x] Repeated calls reuse one client; a different database name gets its own
- [x] The migration probe still gets a fresh, time-bounded client, and never becomes the default
- [x] MongoDB's open connection count is flat under repeated applicant requests, demonstrated
      against a running stack
- [x] The back-end suite passes (794)

## What this does NOT fix

**It is not the cause of `E06/F01/S02`.** That was the hypothesis this investigation started from,
and it was tested and refused: with ~400 leaked clients deliberately created, the endpoint's
latency stayed flat at 19-20ms across three heartbeat windows. See that story for where the
evidence now points.
