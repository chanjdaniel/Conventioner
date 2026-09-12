---
id: E06/F01/S01
title: Fix flaky applicant-form wait in essential-fields.spec.ts
type: story
status: ready
blocked_by: []
pr: []
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
