---
layer: business
kind: rule
describes:
  - back-end/market_documents.py#applicant_intake_market_by_slug
  - back-end/market_documents.py#APPLICANT_SURFACE_PHASES
  - back-end/api/applicant_auth.py#request_login_code
  - back-end/api/applicant_auth.py#verify_login_code
  - back-end/tests/test_applicant_intake_gate.py
  - front-end/e2e/intake-mode.spec.ts
verified: 2026-10-22
sources:
  - wayfinding/v0-1-0/06
  - wayfinding/v0-1-0/07
  - E03/F02/S02
  - E26/F07/S02
  - E32/F03/S01
  - bug/20
---

# A gated market answers as absent

A market whose applicant surface is closed (a CSV market in any phase, or any market still a draft) answers every applicant request exactly as a market that does not exist.
**Never add a "not accepting applications online" message: it confirms to any stranger guessing slugs that the market is real.**

## Why

Between a stranger learning nothing and a stranger learning that an organizer they have never met is running a market, the product takes the first.
A friendlier notice was considered and rejected for exactly that, and so was redirecting to check-in, which turns a stranger's typo into a vendor-facing page.
A gated market is invisible on the applicant side and fully visible on the check-in side, and neither side has to reason about the other.

**The two applicant-login endpoints keep their *uniform* response rather than gaining a 404 of their own**: requesting a code always answers the same 200, and every failed verification the same 401.
A 404 there would be an oracle saying "this slug is a CSV market" where every other answer says nothing.
The sign-in page itself reads the public form first, so at a gated or unknown address it says the page does not exist and never takes an address (E32/F03/S01); it used to draw a sign-in form and answer "sent" for a code it never sent.

**A form market serves applicants in every phase but draft** (`APPLICANT_SURFACE_PHASES`, E26/F07/S02).
An applicant may always sign in and read their own application and its outcome; closing the surface with applications hid every verdict (bug 20).
Applying itself stays `applications_open`'s ([an applicant never reads a verdict early](an-applicant-never-reads-a-verdict-early.md)).

## Where it is kept

- **`applicant_intake_market_by_slug()`** ([`back-end/market_documents.py`](../../../back-end/market_documents.py)) is the single expression of the gate: a market at the slug, in a phase of `APPLICANT_SURFACE_PHASES`, whose intake mode is `form`, or `None`, the same answer as for a slug that names nothing.
  Every caller's existing not-found branch serves that `None`, so the gate needs no message of its own; the lookup is kept with [the market document](../../implementation/data/market-document.md), whose slug and draft rules it reads.
- **It is read by exactly the five applicant endpoints**: requesting and verifying a sign-in code (`request_login_code`, `verify_login_code` in [`back-end/api/applicant_auth.py`](../../../back-end/api/applicant_auth.py)), and reading the public form, reading one's own application and saving it (`back-end/api/applicants.py`).
  It is one lookup rather than a check in each endpoint, because five checks are five chances to forget the sixth.
- **It is not the check-in lookup**, because check-in must stay open to every market that runs ([attendance and the door](../../implementation/modules/attendance-and-door.md)); both narrow `market_by_slug`, each with its own phases.
- What the mode is and when it may change: [intake mode decides how vendors arrive](intake-mode-decides-how-vendors-arrive.md), and why absence is CSV, [ADR 0006](../../adr/0006-intake-mode-fails-closed.md).
- [`front-end/e2e/intake-mode.spec.ts`](../../../front-end/e2e/intake-mode.spec.ts) asserts the gated and absent renders are identical, text and final address alike, at `/<slug>`, `/apply`, `/applicant-login` and `/applicant/dashboard`, rather than asserting each alone; and that a vendor already signed in to a market taken back to draft is shown what a stranger is.
  [`back-end/tests/test_applicant_intake_gate.py`](../../../back-end/tests/test_applicant_intake_gate.py) pins the five endpoints and the open check-in.
