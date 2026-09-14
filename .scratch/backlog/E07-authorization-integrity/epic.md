---
id: E07
title: Authorization integrity
type: epic
status: done
blocked_by: []
pr: []
---

## Outcome

A request can only do what the **authenticated session** is allowed to do.
No endpoint anywhere takes the caller's identity from something the caller controls.

## Why now

Two vulnerabilities were proven by request against the running stack on 2026-09-14
(`.lavish/mvp-findings.html`, findings S1 and S2):

- **Cross-tenant read and write.** A second account with no relationship to a market read all 232
  applicant names and email addresses, and rejected one of the victim's applications, by setting
  `X-Owner-Email` to the victim's address. The honest request from the same account got a correct
  403. `@login_required` proves the caller is *some* authenticated user; it never constrains which
  user the header may claim to be. 33 routes in `back-end/app.py` authorize this way.
- **Unauthenticated account deletion.** `POST /delete-user` has no `@login_required` at all, and its
  ownership check compares the header against the request body - both attacker-controlled - so the
  equality always holds. A verified account was deleted with a bare `curl`, no session, no password.
  The handler also notes "We don't transfer ownership here", so deleting an organization's owner
  strands the organization and every market in it.

The root misconception is written down at `back-end/app.py:385`: a comment saying the header is
"set by login_required decorator". It is not. The client sets it.

## Not on the map

Deliberately. There is no decision here - identity comes from the session - so this is not fog and
it does not wait for [Map: Real-market readiness](../../wayfinding/real-market-readiness/map.md).
