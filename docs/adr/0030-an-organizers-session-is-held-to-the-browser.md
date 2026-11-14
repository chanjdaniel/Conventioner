---
layer: implementation
kind: adr
describes:
  - back-end/app.py#browser_identifier
  - back-end/app.py#RefusingLoginManager
  - back-end/tests/test_a_changed_network_keeps_the_session.py
verified: 2026-11-14
sources:
  - T318
status: accepted
---

# An organizer's session is held to the browser, not the network

## Context

Flask-Login's "strong" session protection holds a session to a hash of the caller's network address and browser string, and this app answers a request from any other client 401 without ending the sign-in (T177, [the cookies](../implementation/conventions/security-invariants.md#the-cookies)).
The front end takes any 401 as a sign-in that ended: it forgets the stored user and goes to the sign-in page.

At a market's door an organizer's phone moves from the venue's wifi to mobile data, or the carrier changes its public address, and the next request comes from another address.
So the organizer at the door was signed out, and signing in again needed the password or a mailed code on the same shaky network.
Daniel kept "strong" as it was on 2026-11-01 (T169), and E47 held the sign-out as a follow-up: hold the session to something other than the address, without letting a stolen session cookie work from anywhere.

The address added little.
T244's run (Q9) showed the 30-day remember-me cookie already signs in from any address and any browser, making a fresh session held to the new client, so the longer-lived cookie was the less protected one.
The address in the hash is the first entry of `X-Forwarded-For`, read by Flask-Login itself rather than the address `TRUSTED_PROXY_HOPS` settles, so it holds only on a host that overwrites that header.
Both cookies are `HttpOnly` and `Secure`, and since T311 every sign-in is a record on the server that Sign out, Sign out everywhere and a password reset end ([ADR 0029](0029-an-organizers-sign-in-is-kept-on-the-server.md)).

## Decision

**The session protection holds a session to the browser string alone** (Daniel, T318 Q1 (a)).

- The client identifier is `browser_identifier()` in [`app.py`](../../back-end/app.py), the SHA-512 of `browser|` and the request's `User-Agent`, and `RefusingLoginManager` installs it as Flask-Login's `_session_identifier_generator`, the one attribute that every stamp and comparison of a session's `_id` goes through: `login_user`, `hold_a_restored_session_to_its_browser` and `_session_protection_failed`.
  The prefix names the scheme, so the identifier can never equal Flask-Login's own.
- A request with another browser string is still answered 401 and ends no sign-in, as T177 made it, so a session cookie copied to another browser is refused at every request.
- **A session stamped before this change carries over the deploy**: one whose `_id` is Flask-Login's own identifier for this request, the same address and browser, is taken and stamped with the browser's identifier in the same answer.
  From another address or another browser it is refused, as it was before.
- The front end does not change: with the address gone, a 401 is a sign-in that ended or a browser that changed, and both are cases to sign in again.

## Consequences

- An organizer whose phone changes network stays signed in, and so does a remembered one.
- A session cookie stolen together with its browser string works from anywhere until its sign-in ends (12 hours, or 30 days remembered), as a stolen remember-me cookie already did; Sign out everywhere ends it on the server ([ADR 0029](0029-an-organizers-sign-in-is-kept-on-the-server.md)).
- A browser update that changes the browser string signs that browser out, as before.
- **The carry-over is a follow-up**: it may go in any release after this one has been live for 30 days (`REMEMBERED_SIGN_IN_LIFETIME`).
  12 hours is not enough: a remembered sign-in's session cookie carries the same secret as its remember cookie, so a browser left open keeps a session stamped before this change until its sign-in ends, 30 days after it was made.
  Removing it sooner signs those browsers out.
- [`back-end/tests/test_a_changed_network_keeps_the_session.py`](../../back-end/tests/test_a_changed_network_keeps_the_session.py) holds the changed network, another browser, a remembered sign-in and the carry-over; [`front-end/e2e/a-changed-network-keeps-the-organizer-signed-in.spec.ts`](../../front-end/e2e/a-changed-network-keeps-the-organizer-signed-in.spec.ts) checks a vendor in after the page's `X-Forwarded-For` changes.

## Rejected

- **Keep the binding and tell "refused on this network" apart from "ended"**: the app would keep the page and the stored user and say to sign in again here or go back to the first network, but the organizer at the door would still have to sign in again on the network that failed them.
- **Drop the binding** (Flask-Login's "basic", which only marks a session not fresh): no refusal for any change of client, so a copied session cookie would work in any browser, which the browser string still stops at no cost to the door.
