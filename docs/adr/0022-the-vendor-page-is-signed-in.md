---
layer: implementation
kind: adr
describes:
  - back-end/market_documents.py#vendor_page_market_by_slug
  - back-end/api/applicants.py#get_vendor_page
  - back-end/remembered_sign_ins.py
  - front-end/src/views/VendorPage.vue
verified: 2026-11-10
sources:
  - T202
  - T191
  - T318
status: accepted
---

# The vendor page is signed in, and a Google Form market's opens with its results

The nodes it constrains: [a gated market answers as absent](../business/rules/a-gated-market-answers-as-absent.md), [a vendor signs in before they have applied](../business/rules/a-vendor-signs-in-before-applying.md), [an applicant never reads a verdict early](../business/rules/an-applicant-never-reads-a-verdict-early.md), [intake mode decides how vendors arrive](../business/rules/intake-mode-decides-how-vendors-arrive.md), [Publish results waits for the allocation](../business/rules/publish-results-waits-for-the-allocation.md) and [an archived market that ran stays a record](../business/rules/an-archived-market-that-ran-stays-a-record.md); the flows it changes: [applying online](../business/flows/applying-online.md), [Publish results](../business/flows/assignment-and-result.md#i7-publish-results), [the Google Form path](../business/flows/the-google-form-path.md) and [the door on market day](../business/flows/market-day-door.md).

## Context

A vendor had no page of their own at a market.
The market's address, `/<slug>`, showed a bare name and nothing to click; a vendor who applied online read their result only if they found the sign-in at `/<slug>/applicant-login` on their own, and Publish results promised a telling ("Tells every applicant, on their application page") that sent nothing and linked nowhere.
A vendor imported from the organizer's Google Form had no page at all, so the November market's vendors could not read their table in the app.
The check-in was not signed in at all: anyone with the market's address typed any vendor's email, read their seats and checked them in or out, so a check-in proved nothing about who was at the door.
And at the sign-in a mistyped code was burnt on its first try, while the page went on offering "Sign in" for a code that could no longer pass (T191, F22).

## Decision

**One vendor page per market, at the market's own address, `/<slug>`.**
Signed out, it names the market and asks for an email address and then the code sent to it.
Signed in, it shows what fits the market's state: the application while applications are open, the application read-only and "Submitted" while the review and the assignment run, the result ("You have a table" with each day's table, or "You did not get assigned") once results are published, check-in on the market days, and the record of where the vendor sat and when they came once the market is archived after running ([an archived market that ran stays a record](../business/rules/an-archived-market-that-ran-stays-a-record.md)).
It replaces the bare market home, the separate sign-in page, "Your application", the application form page and the public check-in page; their addresses (`/apply`, `/applicant-login`, `/applicant/dashboard`, `/check-in` under the slug) are deleted, not redirected, since nobody uses them (Daniel).
The code email links to it and calls it "your page for <market>".

**One lookup decides whether a market has a vendor page**: `vendor_page_market_by_slug` in [`back-end/market_documents.py`](../../back-end/market_documents.py), a market at the slug, not a draft, and either its intake mode is `form`, or it is `csv` and its results are published or it has reached `market_days`.
Everything else answers as a slug that names nothing, as [a gated market answers as absent](../business/rules/a-gated-market-answers-as-absent.md) requires.
The sign-in, the vendor's own read and the vendor's check-in go through it; applying stays behind `applicant_intake_market_by_slug`, which only a `form` market passes.
`GET /public/markets/<slug>/vendor-page` (`get_vendor_page` in [`back-end/api/applicants.py`](../../back-end/api/applicants.py)) says what the page needs before sign-in, or the gate's not-found; the page itself is [`front-end/src/views/VendorPage.vue`](../../front-end/src/views/VendorPage.vue), a thin frame over one section component per part.

**Every vendor read and write is behind the emailed code.**
No vendor's seats, result or check-in is readable or changeable without signing in as that vendor.

**A Google Form market's page opens with its results.**
It gets Publish results under the same rule as a market whose vendors apply online, Publish market waits for it, and from then its imported vendors sign in with the address their form response gave and read their result, with no application section.
Before that its page answers as absent.
A Google Form market that went live before this change has its page too, since it reached `market_days`, whether or not its results were published, and its vendors read their tables and check in there as if they were: reaching the market days puts the results out (`results_are_out` in `market_documents.py`).

**Check-in proves presence with a door code.**
Attendance shows a QR code and a short typed code, full screen or printed as a poster; the vendor scans it with their phone's own camera, which opens their vendor page and checks them in for today, signing them in first when they are not.
The code stays the same until the organizer presses "New code".
The organizer's own check-in at Attendance stays, the second of two valid paths.
Its rules, each pinned at the HTTP seam (`test_the_door_code.py`, `test_a_vendor_checks_in_with_the_door_code.py`):

- The code is 6 characters from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, made with `secrets` ([`back-end/api/door.py`](../../back-end/api/door.py)); a typed one is read in any case with spaces and dashes ignored, and compared in constant time.
- Only someone who may check vendors in (the "Check vendors in" row, Editor by default) reads it, in any phase, or makes a new one, only in `market_days` and never on an archived market; a Viewer may do neither, so nobody checks vendors in by proxy.
- No market read, Markets list entry, history entry or log carries it: it is stored as `doorCode` on the market document, left out of every read (`NEVER_SERVED_FIELDS` in `market_documents.py`), and a new code's history entry says only whether it replaced one.
- A check-in needs the vendor's own sign-in for that market, `market_days`, a seat for them on that date, and that date within one day of the server's UTC date; the code is compared only after all of those, so a sign-in with no seat cannot probe it, and every refusal writes nothing.
- Its undo takes no code, but the same sign-in, phase and window: on that day it takes back the check-in stored for them, theirs or one an organizer made, and never a past day's.
- Tries are bounded in 15 minutes: 10 check-ins per signed-in address (`check-in:address`), right code or wrong, and the undo counts nothing; a remembered sign-in's resume, 300 per caller (`resume:caller`), counted before its cookie is read ([`back-end/sign_in_limits.py`](../../back-end/sign_in_limits.py)).
  Amended 2026-11-14 (T318): the check-in counted wrong door codes per caller too, 60 in 15 minutes (`check-in:caller`), read before the code was compared, and that count was dropped.
  A venue's wifi is one caller for every vendor on it, so a stale poster after a new code, or many vendors' typos, refused every vendor at the venue, right codes included, for up to 15 minutes.
  What bounds a guess now is the per-address count, behind the vendor's sign-in for this market and a seat on a day within one of the server's: 960 tries a day for one address against 32^6 codes, about one in a million a day.
  Counters it left under `check-in:caller` are never read again and expire by the TTL index, with no migration.

**A sign-in code takes up to five tries within ten minutes.**
After the fifth wrong try it is cancelled, the page says so, and only "Send a new code" is offered; a wrong try says only that someone asked for a code for that address in the last ten minutes, which anyone can make true by asking, so nothing says whether an address applied.

**Remember me keeps a vendor signed in on one device until the market's last date, never more than 120 days.**
It is opt-in, kept in a cookie the page's scripts cannot read, its secret stored on the server only as a hash, and ended for good by Sign out on the server too.
How long it lasts is `remembered_until` in [`back-end/remembered_sign_ins.py`](../../back-end/remembered_sign_ins.py): the earlier of noon UTC on the day after the market's last date and 120 days from the sign-in, and use never extends it.
The device holds a random secret in the cookie `__Host-vendor_remember_<market id>`, a name a subdomain cannot overwrite; the server holds only its SHA-256, in `vendor_remembered_sign_ins` with the market, the address and when it ends.
A new tab with no sign-in of its own asks `applicant-login/resume` once, which answers a live one as a right code does; anything else is one 401, which forgets a secret the browser sent and clears its cookie, and the page asks for a code.
A tab whose own 30-minute sign-in has ended while the page stood open asks it the same way, once, from the request that found it ended, and makes that request again with the new sign-in, so a remembered vendor at the door is not sent a code.
It ends on Sign out (`applicant-login/sign-out`), on the next sign-in at that market on that device, with the market's deletion, and by a TTL index once it has ended; the cookie's settings are in [security invariants](../implementation/conventions/security-invariants.md#the-cookies).

**No email goes out on publishing.**
Publish results says vendors read their result on the vendor page, that no email is sent, and gives the page's address to share.

## Consequences

- The organizer's rail shows one "Vendor page" chip with the address and Copy, where it showed the application page's.
- A vendor keeps one link from applying to the last market day.
- A vendor with a dead phone, no signal or a mistyped imported address is checked in by the organizer at Attendance; editing a vendor's address is not part of this.
- An imported vendor now signs in, which proves the address the code was sent to; still nothing is mailed to an address that did not ask ([an imported email is asserted](../business/rules/an-imported-email-is-asserted.md)).

## Considered and rejected

- **A rotating or time-limited door code**: Daniel saw no need for that much security; one code a market, changed when the organizer chooses, prints one poster for the whole market.
- **A printed QR code per market day**, with no device at the door: a photo of it works from anywhere all day, so it proves little.
- **The organizer scanning each vendor's own QR code**: the strongest proof, but every vendor queues for the organizer.
- **A long-lived token in `localStorage` for Remember me**: any injected script could read it and carry it off.
- **Redirecting the old addresses**: nobody uses them, and a redirect is one more public surface to keep.

## Superseded

- [ADR 0013](0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md)'s "A market that imports its vendors has nobody to tell, and neither publishes nor waits": a Google Form market's vendors are told on their page, so it publishes and Publish market waits for it.
  ADR 0021, "The review reopens until results are published" (T207), also changes ADR 0013, its way back from `assignment`; the two meet only there, and neither changes what the other decides.
- "One code, one attempt", in `applicant_auth.py`'s module docstring and in [a vendor signs in before they have applied](../business/rules/a-vendor-signs-in-before-applying.md): a code now takes five tries.
- [A gated market answers as absent](../business/rules/a-gated-market-answers-as-absent.md) is narrowed: a Google Form market answers once its results are published.
  [ADR 0006](0006-intake-mode-fails-closed.md) stands: absence still means `csv`.
