---
layer: business
kind: flow
verified: 2026-10-21
sources:
  - E26/F07
  - E32/F03/S01
  - E32/F03/S02
  - E36/F05
  - bug/6
  - bug/20
  - bug/21
  - bug/36
  - E06/F01/S01
---

# Applying online

**Who:** a vendor, with no account; they sign in to one market with a code sent to their email.
**Where they start:** the application link the organizer shares from the rail's "Application page" ([H1](taking-applications.md#h1-open-applications)).
**Serves:** [Vendors apply on the market's own page](../intents/vendors-apply-on-the-markets-own-page.md) and [Results go out once, and settle the allocation](../intents/results-go-out-once-and-settle-the-allocation.md).

Only a market whose vendors apply on its own page ("Vendors apply on this market's page", chosen in Draft) has these pages, and only after Draft; applying and changing answers are open only while applications are open ([intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md)).
A vendor signs in before anything about them is known, and the first valid save creates their application ([a vendor signs in before they have applied](../rules/a-vendor-signs-in-before-applying.md)).

## H3. Vendors apply online

**Status:** Works (re-walked live on 2026-10-03; the sign-in and what a vendor reads read from the code as of E32/F03 and E36/F05: `front-end/src/views/ApplicantLogin.vue`, `front-end/src/utils/applicantOutcome.ts`).
Each case below is one of its branches.
Covered by: `applicant.spec.ts`, `a-first-time-vendor-applies.spec.ts`, `returning-vendors-edit-their-answers.spec.ts`, `vendors-see-their-application-after-close.spec.ts`, `intake-mode.spec.ts`, `results-wait-for-the-allocation.spec.ts`.

### H3a. A new vendor applies

**Status:** Works (re-walked live on 2026-10-03 on a phone-sized window; bug 6).
**Task (vendor):** "Apply to this market."

1. The vendor opens the shared link `/<market-slug>/apply`; "Sign in" names the market: "Enter your email address. We'll send you a code to sign in with."
2. They enter their email and "Send code"; the page says "We've sent a code to <email>." whatever the address, and the code is sent before the page answers (E32/F03/S02).
3. The code arrives; they enter it under "Sign-in code" and choose "Sign in".
4. "Apply for <market>": the essential questions, then "More questions" (the custom ones); "Save application".
5. They land on "Your application" (H3c), which reads "Submitted".

An address with no application that signs in on the dashboard instead reads "You have not applied to this market yet." with "Apply now".
When the form or the saved application does not load within 15 seconds, or the request fails, the page says "This market's application form could not be loaded. Check your connection and try again." with "Try again", never that the market is not open and never an endless "Loading application form..." (E06/F01/S01).
Covered by: `a-first-time-vendor-applies.spec.ts`.

### H3b. A returning vendor edits their application

**Status:** Works (re-walked live on 2026-10-03), while applications are open.
Sign in as H3a steps 1 to 3 with an address that already has an application; "Your application" offers "Change your answers".
The form opens with their saved answers; they change what they need and "Save application", and land on "Your application" (bug 21).
A reload or a direct link in the same tab keeps them signed in; a new tab asks them to sign in again (bug 36).
The first applicant save of any kind freezes the essential questions' offering ([F1](form-tab.md#f1-the-essential-questions)).
Covered by: `returning-vendors-edit-their-answers.spec.ts`.

### H3c. A vendor checks their application

**Status:** Works (re-walked live on 2026-10-03, before and after applications closed, bug 20; what a vendor reads changed since, read from the code as of E36/F05).
"Your application" shows the market, "Signed in as", the outcome, "Submitted <date>", "Your Answers", "Change your answers" while applications are open, and "Sign out".
Until the results are published ([I7](assignment-and-result.md#i7-publish-results)) every vendor reads "Submitted", whatever their verdict, and an automatic rejection says nothing either.
After, exactly one of "You have a table", with each date's table and location listed, or "You did not get assigned"; never a verdict and never a reason ([an applicant never reads a verdict early](../rules/an-applicant-never-reads-a-verdict-early.md)).
A vendor can sign in and read their application in every phase after Draft; applying and changing answers stop when applications close, and an address with no application then reads "You have no application at this market, and it is not taking applications."
Covered by: `vendors-see-their-application-after-close.spec.ts`, `results-wait-for-the-allocation.spec.ts`, `a-first-time-vendor-applies.spec.ts` ("a vendor a rule rejects as they apply reads "Submitted", as anyone would").

### H3d. Codes that fail

**Status:** Works (code).
One attempt per code: a wrong code uses it up; "Code already sent - retry in Ns" and "Resend code in 60s" pace requests; every failure reads "Invalid or expired code." so nothing reveals whether an address applied.
Covered by: `applicant.spec.ts`.

### H3e. A Google Form market's public pages

**Status:** Works (walked live; the sign-in page read from the code as of E32/F03/S01).
`/<slug>/apply`, the sign-in page and the dashboard of a market whose vendors apply on the organizer's own Google Form answer exactly as for a market that does not exist; the sign-in page says the page does not exist rather than taking an address ([a gated market answers as absent](../rules/a-gated-market-answers-as-absent.md)).
Covered by: `intake-mode.spec.ts`.

## The rules it obeys

- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md).
- [A gated market answers as absent](../rules/a-gated-market-answers-as-absent.md).
- [A vendor signs in before they have applied](../rules/a-vendor-signs-in-before-applying.md).
- [An applicant never reads a verdict early](../rules/an-applicant-never-reads-a-verdict-early.md).
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md).

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
