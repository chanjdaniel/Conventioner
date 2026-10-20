---
id: E32/F03/S02
title: The sign-in code is sent within the request
type: story
status: done
blocked_by: []
pr: [#109]
---

## What to build

The applicant code request sends its email before it responds, instead of from a daemon thread after the response: on serverless hosting the process may be frozen once the response is out, and no such send has ever been seen to deliver.
The thread existed to close a timing oracle; that oracle is gone, because every address that asks is sent a code, so the work is the same for every address on a market that takes applications.
The remaining difference, a market that takes applications against one that does not, says only what that market's public page already says.
A failed send is logged, and the response stays uniform.

## Acceptance criteria

- [x] A code request on a form market sends the email before the response returns.
- [x] The response is identical whether the send succeeded or failed, and for known and unknown addresses.
- [x] A failed send is logged with enough to find it.
- [ ] Verified once in production with `S03`'s form market: the code arrives, and Resend records it.
