---
id: E06/F01/S01
title: Fix flaky applicant-form wait in essential-fields.spec.ts
type: story
status: done
blocked_by: []
pr: [#55]
---

## What to build

The essential-fields applicant story passes on the first attempt, every time.

Observed on `dev` at commit `3307caf0` (CI run `34673260536`'s predecessor, `34673233823`):
`essential-fields.spec.ts:225` - "the applicant answers the essential questions and the answers persist" - failed at line 239 on `await expect(apply.form).toBeVisible()` with "element(s) not found" after 12.2s, then passed on retry #1 in 3.5s.
The whole job failed on that one flake; the other 45 tests passed.

The 12.2s-then-3.5s shape says the first attempt waited out a timeout on something that was never going to appear, while the retry found it almost immediately - which points at a race in reaching the form, not at a slow render.
The applicant path goes through an email login-code challenge, so the seeded challenge, the code submission, and the redirect to the form are all candidates.

Diagnose the actual cause before changing the wait.
Adding a longer timeout or a hard wait would hide it, and this spec was added days ago, so the race is fresh and findable.

## Acceptance criteria

- [ ] Root cause identified and stated - what is racing with what
- [ ] Fix addresses that cause rather than extending a timeout
- [ ] Spec passes repeatedly under load; run it many times in a row against an isolated stack rather than declaring success on one green run
- [ ] No `waitForTimeout` or bare sleep introduced
- [ ] If the race is in the seed helper or page object rather than the spec, fix it there so sibling specs benefit

## Notes

Related recent change: PR #45 switched the e2e login-challenge seed helper from `insertOne` to an upsert `replaceOne` to match production's one-challenge-per-(market, email) semantics.
That is in the path this test exercises and is worth examining first.

Reproduce with an isolated stack per `AGENTS.md`: `DISABLE_EMAIL=true scripts/th-compose.sh up -d`, then `scripts/seed_fixture.sh`, then the spec.

## Diagnosis

**Reproduced and proven, not guessed at.** The spec passes 24/24 in isolation at ~1.7s each; it only
fails inside a full-suite run, and there it fails on roughly one run in two.

The failure artifact settles it. At the moment of the timeout the page reads:

```
- text: Loading application form...
```

So the page was still on its loading state: `ApplicationPage`'s `onMounted` fetch of the public
application form had not resolved. Not a redirect, not an auth race, and not the "market is closed"
path - the request simply had not answered yet.

**The race is between `waitForURL` and the page's own load.** `waitForURL` returns the moment the
route changes, while the new page is still fetching. The spec then asserted on `apply-form`, so an
element assertion's budget was implicitly being spent on a network round trip. Under full-suite
contention that round trip sometimes exceeds it.

## Fix

Two parts, neither of them a longer wait on the same wrong condition.

1. **Product**: the fetch had no timeout and swallowed every error into "this market is not open".
   A stalled request therefore left the applicant on `Loading application form...` for ever, and a
   failed one told them their market was closed when we had simply never asked it. It now has a
   bounded timeout and reports failure, and the page shows a load-failed state with a retry rather
   than an indefinite spinner or a false verdict.
2. **Test**: wait for the page to have *finished* loading - `apply-loading` hidden, and no
   load-failed state - then assert what it shows. That is waiting on the right condition, and it
   keeps the assertion on the form itself strict.

## Verification

Six consecutive full-suite runs against an isolated stack, all green (318 test executions), where
the same loop previously failed on the second iteration.
