---
layer: business
kind: rule
describes:
  - back-end/utils/application_token.py
  - back-end/api/applicant_auth.py#request_login_code
  - back-end/api/applicant_auth.py#verify_login_code
  - back-end/api/applicants.py#save_applicant_application
verified: 2026-10-22
sources:
  - E26/F07/S01
  - E32/F03/S02
  - bug/6
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
- **Verifying a code** (`verify_login_code`) consumes the challenge with its first attempt, right or wrong, so there is no attempt counter and no lockout, and every failure answers one 401.
  A right code returns a token for whoever proved the address, applied or not.
- **The token** ([`back-end/utils/application_token.py`](../../../back-end/utils/application_token.py)) names the market and the address, never an application, lasts 30 minutes and creates no session; it is signed with the app's one signing secret, which has no fallback.
  An applicant's application is found by market and address, its identity.
- **The first valid save creates the application** (`save_applicant_application` in [`back-end/api/applicants.py`](../../../back-end/api/applicants.py)): the answers are checked before anything is made, so a refused first try leaves nothing behind for the organizer to review as an empty application, and the application is created through the identity index of [the application document](../../implementation/data/application-document.md#indexes).
  The save is open only while the market is in `applications_open` ([an applicant never reads a verdict early](an-applicant-never-reads-a-verdict-early.md)).
- A market's outstanding codes are deleted with it ([market deletion](../../implementation/modules/market-deletion.md)).
