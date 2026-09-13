---
id: E06/F01/S02
title: The public application-form request stalls under suite load
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

`GET /public/markets/<slug>/application-form` answers promptly under a full-suite run, every time.

## What is known

This is the residue of E06/F01/S01, and the diagnosis there was incomplete. That story proved the
applicant page was stuck on its loading state because the request had not resolved, and treated the
cause as the test racing the page's own load. Waiting for the page to finish loading did make the
suite green - for six consecutive full-suite runs locally - but it did not make the request fast.

The evidence that it is a **stall, not an error**:

- Before a timeout existed, the page sat on `Loading application form...` indefinitely.
- After a 15s client timeout was added, the same run produced the page's *load-failed* state
  instead. An error would have produced that immediately; a stall is what turns into it at 15s.
- It passes 24/24 in isolation at ~1.7s per run. It only misbehaves inside a full-suite run, and
  intermittently - roughly one run in two before S01, rarer since.

So something makes that request take longer than fifteen seconds while the rest of the suite is
running, on a request that normally answers in milliseconds against an indexed lookup.

## Where to look

Revised 2026-09-13 after an investigation that narrowed it without closing it.

### Ruled out: the Flask dev server serialising requests

`flask run` defaults `--with-threads` to **true** (Flask 3.0), so the dev server is threaded and a
slow request does not block the accept loop. A queue behind one slow request is not the mechanism.

### Ruled out as the cause: a leaked MongoDB client per request

This looked extremely promising and was wrong, which is worth recording so nobody spends the time
again.

`api/applicants.py` was building a **new `MongoClient` inside four request handlers**, including
`get_public_application_form` - the exact endpoint that stalls - and it was the only module in the
codebase doing so; every other one builds a client at import. A `MongoClient` is a connection pool
with background monitor threads that nothing closes, so each request leaked one. That fits the
symptom shape exactly: invisible in isolation, worsening across a long run, intermittent, a stall
rather than an error, and specific to *these* endpoints.

It is a real defect and it is fixed (`E06/F03/S01`, measured: applicant requests took MongoDB's
open connection count from 28 to 60 while `/markets` never moved it; flat at 9 afterwards).

**But it is not this stall.** With ~400 leaked clients deliberately created against a live stack,
the endpoint answered in **19-20ms, flat**, sampled across three 10-second heartbeat windows. The
leak does not produce the latency.

### Where suspicion now sits

**Vite's dev proxy**, which is the one part of the path every reproduction attempt so far has
skipped. Every probe above used `curl` straight to the back end and could not reproduce the stall
at any scale. The browser does not: it talks to Vite, which proxies to the back end over HTTPS with
a self-signed certificate. That is also the only component under real load from something other
than the request itself, since it is transforming modules for the page at the same time.

A reproduction has to go through the proxy, under a browser, with the rest of the suite running.

### Still unexamined

- Whether an earlier spec leaves a long-running request in flight that this one queues behind.
- Whether the stall correlates with a particular preceding spec, which the suite's fixed ordering
  would make visible: run the suite with `--repeat-each` or a shuffled order and see if the
  failure follows a neighbour rather than the clock.

Backend timing logs around the public endpoints during a failing run would still settle it; the
stack teardown in `scripts/nm-test.sh` discards them, so capture them first.

### Note on frequency

Three consecutive full-suite runs passed on 2026-09-13 with the retry workaround still in place and
never firing. That is consistent with "rarer since S01" and is **not** evidence the defect is gone:
it was already intermittent at roughly one run in two before S01, and three green runs cannot clear
that.

## Acceptance criteria

- [ ] The cause is identified and stated, not inferred
- [ ] The request answers promptly under full-suite load, demonstrated over repeated runs
- [ ] The retry workaround in `signInApplicant` is removed, and the spec passes without it
- [ ] If the cause is environmental rather than a product defect, that is recorded here and the
      product's timeout and retry behaviour is left in place deliberately rather than by accident

## Notes

The product-side changes from S01 stay regardless: a bounded timeout and a retry are correct for an
applicant on a bad connection, and they are what turned a silent indefinite spinner into something
that says what happened. This story is about the stall behind them.

The workaround to remove is in `signInApplicant` (`front-end/e2e/essential-fields.spec.ts`), which
clicks the page's own retry when the first load fails. It is commented as a workaround. If it starts
firing routinely rather than rarely, this story is overdue.
