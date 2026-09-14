---
id: E07/F01/S01
title: Close unauthenticated account deletion
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

`POST /delete-user` requires an authenticated session, and deletes only the account that session
belongs to. A caller with no session cannot delete anything.

The unverified-account cleanup this endpoint was carrying is not an anonymous endpoint's job.
Either move it behind the same session requirement or make it a maintenance task; do not keep an
anonymous path open for it.

Taken first because it is the only one of the two reachable with no account at all.

## Acceptance criteria

- [ ] A request with no session cannot delete any account, verified or not.
- [ ] An authenticated caller cannot delete an account other than their own, whatever headers they send.
- [ ] A test covers the exact proven attack: no cookie, `X-Owner-Email` and body both naming a verified victim.
- [ ] Deleting an account that owns an organization does not silently strand it; the behaviour is decided and tested rather than left to the existing comment.
