---
layer: business
kind: rule
describes:
  - back-end/utils/application_token.py
  - back-end/api/applicant_auth.py#request_login_code
  - back-end/api/applicant_auth.py#verify_login_code
  - back-end/api/applicants.py#save_applicant_application
  - back-end/sign_in_limits.py
verified: 2026-10-29
sources:
  - E26/F07/S01
  - E32/F03/S02
  - bug/6
  - E38/F07/S03
---

# A vendor signs in before they have applied

A vendor applying on a market's page proves their address with an emailed code first, whether or not they have applied; their first save that the form accepts creates their application.
Every address that asks is sent a code, and the sign-in names the person and the market, never an application.

**Serves:** [Vendors apply on the market's own page](../intents/vendors-apply-on-the-markets-own-page.md) and [A request can only do what its session may](../intents/a-request-can-only-do-what-its-session-may.md).

## Why

Codes once went only to addresses with an application, and a token was issued only with one, while nothing created a first application before sign-in: together they made the "Vendors apply on this market's page" option unable to take a single new application (bug 6).
**Do not reintroduce "send only to known addresses" or "token only with an application".**

Sending to every address is also the strongest form of the login ruling, that requesting a code reads the same for everyone: the work is identical for all, not merely the response, so neither the answer nor its timing says whether an address has applied.
Telling the person who just read the code whether they have applied leaks nothing; the ruling is about strangers.

## Where it is kept

- **Requesting a code** (`request_login_code` in [`back-end/api/applicant_auth.py`](../../../back-end/api/applicant_auth.py)) stores a challenge for every address at a market [the gate](a-gated-market-answers-as-absent.md) serves and sends it before the response goes out (E32/F03/S02): on serverless hosting a process may be frozen the moment its response is out, and no code sent from a thread afterwards was ever seen to arrive.
  A failed send is logged and answered as a sent one.
  The code is six digits, kept hashed in `applicant_login_challenges` keyed by market and address, and lasts five minutes.
- **Verifying a code** (`verify_login_code`) consumes the challenge with its first attempt, right or wrong, so there is no per-applicant attempt counter and no lockout, and every failure answers one 401, a code or address sent as anything but a string included.
  A right code returns a token for whoever proved the address, applied or not.
- **The token** ([`back-end/utils/application_token.py`](../../../back-end/utils/application_token.py)) names the market and the address, never an application, lasts 30 minutes and creates no session; it is signed with the app's one signing secret, which has no fallback.
  An applicant's application is found by market and address, its identity.
- **The first valid save creates the application** (`save_applicant_application` in [`back-end/api/applicants.py`](../../../back-end/api/applicants.py)): the answers are checked before anything is made, so a refused first try leaves nothing behind for the organizer to review as an empty application, and the application is created through the identity index of [the application document](../../implementation/data/application-document.md#indexes).
- **A save that leaves the application open is its arrival**: with reviewers chosen, it is dealt to the next reviewer in turn, after the rules judge it, and the market's history records that under the applicant's own address ([the review is dealt among chosen reviewers](the-review-is-dealt-among-chosen-reviewers.md)).
  The save is open only while the market is in `applications` and taking applications ([an applicant never reads a verdict early](an-applicant-never-reads-a-verdict-early.md)).
  Their first save, and each edit that changes an answer, is recorded in [the market's history](../../implementation/data/history.md) with their address as the actor.
- A market's outstanding codes are deleted with it ([market deletion](../../implementation/modules/market-deletion.md)).

## Sign-in is bounded

Each code request sends an email and each verify is a guess at a six-digit code, so an unbounded caller could use the product to flood any address with mail or keep guessing.
**Both endpoints are rate limited per address and per caller**, every limit in one table in [`back-end/sign_in_limits.py`](../../../back-end/sign_in_limits.py): 5 code requests per address and 30 per caller, 10 verifies per address and 60 per caller, each per 15 minutes.
A refused attempt still counts.

- **The counters live in the database, never in a process**: a serverless deployment forgets memory.
  One document per limit, subject and fixed clock-aligned window in `sign_in_attempts`, counted by an atomic `$inc` upsert and removed by a TTL index ([lookup indexes](../../implementation/data/lookup-indexes.md)).
  Its key is a hash, so the collection names no address and no caller.
- **The caller is counted before the body or the slug is read**, then the address, so a refusal is the same for every address and every market, real or not.
  A limit is the same for every address, applicant or not, so it is not the attempt counter the login ruling forbids: that one existed only for addresses that had applied, and so answered whether they had.
  The caller is `request.remote_addr` as [`TRUSTED_PROXY_HOPS`](../../implementation/conventions/security-invariants.md#the-boot-check) resolves it.
- **Past a limit the answer is a 429** with `Retry-After` and "Too many sign-in attempts. Please try again in N minutes.", which the sign-in screen shows as it stands; nothing is stored, sent or consumed.
- Organizer sign-in has its own, older checks in `api/users.py`.
- The E2E suite clears the counters at the start of every run ([E2E patterns](../../implementation/testing/e2e-patterns.md#sharp-edges)).
