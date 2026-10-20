---
id: E32/F03
title: A Google Form market has no applicant surface, and the sign-in code is sent
type: feature
status: done
blocked_by: []
pr: []
---

## Outcome

A Google Form market's public application address, including its sign-in page, looks exactly like a market that does not exist.
On a market that takes applications online, the applicant's sign-in code is actually delivered in production.

## Why now

Brain dump 2026-10-19: in production, a sign-in code was requested on a market started from a Google Form and never arrived.
Resend's logs show that no applicant code email has ever been sent from production, to anyone.
Either the market was a Google Form market (nothing is sent, by design, behind a page that still showed a sign-in form), or the send, made from a daemon thread after the response, never completes on Vercel.
The test markets have since been cleared, so which one it was cannot be settled; both are fixed here.

## Stories

- `S01` - a Google Form market's sign-in page renders as an absent market.
- `S02` - the sign-in code is sent within the request.
- `S03` - a test market of each path, for checking in production.
- `S04` - the doubled verification email.
