---
layer: business
kind: rule
describes:
  - back-end/market_documents.py#vendor_page_market_by_slug
  - back-end/market_documents.py#applicant_intake_market_by_slug
  - back-end/market_documents.py#APPLICANT_SURFACE_PHASES
  - back-end/api/applicant_auth.py#request_login_code
  - back-end/api/applicant_auth.py#verify_login_code
  - back-end/tests/test_applicant_intake_gate.py
  - front-end/e2e/intake-mode.spec.ts
verified: 2026-11-03
sources:
  - wayfinding/v0-1-0/06
  - wayfinding/v0-1-0/07
  - wayfinding/the-order-of-the-work/09
  - wayfinding/the-order-of-the-work/map
  - brain-dump/2026-10-19#26
  - E03/F02/S02
  - E18/F04/S02
  - E26/F07/S02
  - E32/F03/S01
  - E32/F03/S02
  - E03
  - E03/F02
  - E03/F03
  - bug/20
  - T202
---

# A gated market answers as absent

A market whose applicant surface is closed (a CSV market in any phase, or any market still a draft) answers every applicant request exactly as a market that does not exist.
**Never add a "not accepting applications online" message: it confirms to any stranger guessing slugs that the market is real.**

**Serves:** [Vendors apply on the market's own page](../intents/vendors-apply-on-the-markets-own-page.md).

## Why

Between a stranger learning nothing and a stranger learning that an organizer they have never met is running a market, the product takes the first.
A friendlier notice was considered and rejected for exactly that, and so was redirecting to check-in, which turns a stranger's typo into a vendor-facing page.
A gated market is invisible on the applicant side and fully visible on the check-in side, and neither side has to reason about the other.

**A market's bare address, `/<slug>`, is its vendor page** ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)) and answers the same way: a gated market's is "page not found", and a form market's names the market and asks for an email address and the code sent to it ([`VendorPage.vue`](../../../front-end/src/views/VendorPage.vue)).
There is no public landing page for a market beyond that.

**The two applicant-login endpoints keep their *uniform* response rather than gaining a 404 of their own**: requesting a code always answers the same 200, and every failed verification the same 401.
A 404 there would be an oracle saying "this slug is a CSV market" where every other answer says nothing.
The vendor page reads `GET /public/markets/<slug>/vendor-page` first, which answers a gated or unknown slug with the same 404, so there it says the page does not exist and never takes an address (E32/F03/S01); a sign-in page once drew its form and answered "sent" for a code it never sent.
Until the market answers, the page says it is loading and draws neither; a request that fails in transit is not an answer, and the page says it could not be loaded, with Try again.

**The code is sent within the request**, before the response goes out, to every address that asks at a market the gate serves ([a vendor signs in before they have applied](a-vendor-signs-in-before-applying.md)).
A gated market answers without sending anything, so the time a request takes says only that the market takes applications online, which its public page already says.

**A form market has a vendor page in every phase but draft** (`APPLICANT_SURFACE_PHASES`, E26/F07/S02).
An applicant may always sign in and read their own application and its outcome; closing the surface with applications hid every verdict (bug 20).
Applying itself stays the `applications` phase's, while the organizer takes applications ([an applicant never reads a verdict early](an-applicant-never-reads-a-verdict-early.md)).

**The organizer's own link to the page follows the gate.**
The rail shows the vendor page's address, "Vendor page" with Copy, only for a form market, from the first phase after draft until it is archived, and after that only for a market that ran ([the phase rail](../../implementation/modules/phase-rail.md)).
A CSV market shows none in any phase, since a link there would be the one place the product admitted the market was real; a draft shows none, since its page deliberately tells the organizer nothing either.
The check-in chip waits for `market_days` because before then its page is absent; the vendor page answers in every phase after draft, so its chip shows in each, and an archived market's page is the record of where its vendors sat only if it ran.

## Where it is kept

- **`vendor_page_market_by_slug()`** ([`back-end/market_documents.py`](../../../back-end/market_documents.py)) decides whether a market has a vendor page: a market at the slug, in a phase of `APPLICANT_SURFACE_PHASES`, whose intake mode is `form`, or `None`, the same answer as for a slug that names nothing.
  It is read by the page's own public read (`get_vendor_page`), requesting and verifying a sign-in code (`request_login_code`, `verify_login_code` in [`back-end/api/applicant_auth.py`](../../../back-end/api/applicant_auth.py)), and the vendor's own read (`get_applicant_application` in `back-end/api/applicants.py`).
- **`applicant_intake_market_by_slug()`**, beside it, is the gate of applying: the public form and the save, which only a `form` market has.
  Every caller's existing not-found branch serves either's `None`, so the gate needs no message of its own; both are kept with [the market document](../../implementation/data/market-document.md), whose slug and draft rules they read.
  Each is one lookup rather than a check in each endpoint, because a check in each is a chance to forget one.
  The two sign-in endpoints count their caller against [the sign-in limits](a-vendor-signs-in-before-applying.md#sign-in-is-bounded) before they ask it, so a refusal past a limit is also the same for a gated market as for an absent one.
- **It is not the check-in lookup**, because check-in must stay open to every market that runs ([attendance and the door](../../implementation/modules/attendance-and-door.md)); both narrow `market_by_slug`, each with its own phases.
- What the mode is and when it may change: [intake mode decides how vendors arrive](intake-mode-decides-how-vendors-arrive.md), and why absence is CSV, [ADR 0006](../../adr/0006-intake-mode-fails-closed.md).
- The intake-mode control exists because this gate is what keeps the address from simply being shown: which mode a market has decides whether the page is real ([intake mode decides how vendors arrive](intake-mode-decides-how-vendors-arrive.md)).
- [`front-end/e2e/intake-mode.spec.ts`](../../../front-end/e2e/intake-mode.spec.ts) asserts the gated and absent renders are identical, text and final address alike, at `/<slug>` and `/apply` (and at the deleted `/applicant-login` and `/applicant/dashboard`, which every market answers as not found), rather than asserting each alone; and that a vendor already signed in to a market taken back to draft is shown what a stranger is.
  [`back-end/tests/test_applicant_intake_gate.py`](../../../back-end/tests/test_applicant_intake_gate.py) pins the applying endpoints, the sign-in and the vendor's read on a CSV market, and the open check-in, and [`back-end/tests/test_the_vendor_page.py`](../../../back-end/tests/test_the_vendor_page.py) the vendor page's gate and its public read, byte for byte against an unknown slug.

## Superseded

The application page's chip was to show in every phase of a form market, draft included, on the grounds that the page answers in every phase (wayfinding/the-order-of-the-work/09); a draft's page answers as absent, so the chip starts at the first phase after draft (E18/F04/S02).
