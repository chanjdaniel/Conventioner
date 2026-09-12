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

Unproven, in rough order of suspicion:

- The Flask development server's concurrency under `--cert=adhoc`: every request is a fresh TLS
  connection, and a queued request behind a slow one would look exactly like this.
- Vite's dev proxy in front of it, which is what the browser actually talks to.
- Whether an earlier spec leaves a long-running request in flight that this one queues behind.

Backend timing logs around the public endpoints during a failing run would settle it quickly; the
stack teardown in `scripts/nm-test.sh` currently discards them, so capture them first.

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
