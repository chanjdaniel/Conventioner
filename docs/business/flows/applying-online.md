---
layer: business
kind: flow
verified: 2026-11-05
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
  - T202
---

# Applying online

**Who:** a vendor, with no account; they sign in to one market with a code sent to their email.
**Where they start:** the market's vendor page, `/<market-slug>`, which the organizer shares from the rail's "Vendor page" ([H1](taking-applications.md#h1-open-applications)); it is the one page a vendor uses at the market ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)).
**Serves:** [Vendors apply on the market's own page](../intents/vendors-apply-on-the-markets-own-page.md) and [Results go out once, and settle the allocation](../intents/results-go-out-once-and-settle-the-allocation.md).

Only a market whose vendors apply on its own page ("Vendors apply on this market's page", chosen in Draft) has these pages, and only after Draft; applying and changing answers are open only while applications are open ([intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md)).
A vendor signs in before anything about them is known, and the first valid save creates their application ([a vendor signs in before they have applied](../rules/a-vendor-signs-in-before-applying.md)).

## H3. Vendors apply online

**Status:** Works (re-walked live on 2026-10-03; the sign-in and what a vendor reads read from the code as of T202: `front-end/src/views/VendorPage.vue`, `front-end/src/utils/vendorPage.ts`, `front-end/src/utils/applicantOutcome.ts`).
Each case below is one of its branches.
Covered by:
- `a-first-time-vendor-applies.spec.ts`
- `applicant.spec.ts`
- `essential-fields.spec.ts`
- `intake-mode.spec.ts`
- `results-wait-for-the-allocation.spec.ts`
- `returning-vendors-edit-their-answers.spec.ts`
- `the-vendor-page.spec.ts`
- `vendors-see-their-application-after-close.spec.ts`

### H3a. A new vendor applies

**Status:** Works (re-walked live on 2026-10-03 on a phone-sized window, bug 6; the form on the vendor page itself read from the code as of T202).
**Task (vendor):** "Apply to this market."

1. The vendor opens the shared link `/<market-slug>`; the page names the market over "Sign in": "Enter your email address. We'll send you a code to sign in with."
2. They enter their email and "Send code"; the page says "We've sent a code to <email>. Only the newest one works." whatever the address, and the code is sent before the page answers (E32/F03/S02); its email links back to the page, "your page for <market>".
3. The code arrives; they enter it under "Sign-in code" and choose "Sign in".
4. The page reads "You have not applied to this market yet." with "Apply", which opens the form in its place, on the same page and address: "Apply", the essential questions, then "More questions" (the custom ones); "Save application" and "Cancel".
5. Saved, the form closes on "Your answers" with "Edit", and the page reads "Submitted" (H3c).
A save the server refuses says why above "Save application", and every answer typed stays; a required answer left blank is named under its question before anything is sent.
A one-choice answer the form no longer offers counts as blank there, since its control shows nothing chosen.
A question of more than 12 options is a field they type in to find an answer, one choice or several as chips; words they typed and did not choose clear when they leave the field ([the design language](../../design-system.md)).
The vendor page reads the form and the saved application together before it draws; when either does not load within 15 seconds, or the request fails, it says "This page could not be loaded" with "Try again", never that the market is not open and never an endless "Loading..." (E06/F01/S01).
Covered by:
- `a-first-time-vendor-applies.spec.ts`
- `choices-at-scale.spec.ts`
- `essential-fields.spec.ts`

### H3b. A returning vendor edits their application

**Status:** Works (re-walked live on 2026-10-03; the form on the vendor page itself read from the code as of T202), while applications are open.
Sign in as H3a steps 1 to 3 with an address that already has an application; the vendor page shows "Your answers" with "Edit".
"Edit" opens the form in their place, "Edit your answers", filled with their saved answers (bug 21); they change what they need and "Save application", and the form closes on the answers as saved; "Cancel" closes it and changes nothing.
A reload or a direct link in the same tab keeps them signed in; a new tab asks them to sign in again (bug 36).
The first applicant save of any kind freezes the essential questions' offering ([F1](form-tab.md#f1-the-essential-questions)).
Covered by:
- `returning-vendors-edit-their-answers.spec.ts`

### H3c. A vendor checks their application

**Status:** Works (re-walked live on 2026-10-03, before and after applications closed, bug 20; what a vendor reads changed since, read from the code as of E36/F05).
Signed in, the vendor page shows the market, "Signed in as" their name and address, the outcome, "Submitted <date>", "Your answers" with "Edit" while applications are open, and "Sign out", which asks for an email address again.
A sign-in that has ended asks for one too, saying "Your session has expired. Please sign in again.", unless the device is remembered, when the page signs them straight back in and goes on; a read that never answers says "This page could not be loaded" with "Try again".
Until the results are published ([I7](assignment-and-result.md#i7-publish-results)) every vendor reads "Submitted", whatever their verdict, and an automatic rejection says nothing either.
After, exactly one of "You have a table", with each date's table and location listed, or "You did not get assigned"; never a verdict and never a reason ([an applicant never reads a verdict early](../rules/an-applicant-never-reads-a-verdict-early.md)).
A vendor can sign in and read their application in every phase after Draft; applying and changing answers stop when the organizer stops taking applications, and an address with no application then reads "You have no application at this market, and it is not taking applications."
Covered by:
- `a-first-time-vendor-applies.spec.ts` ("a vendor a rule rejects as they apply reads "Submitted", as anyone would")
- `results-wait-for-the-allocation.spec.ts`
- `the-vendor-page.spec.ts`
- `vendors-see-their-application-after-close.spec.ts`

### H3d. Codes that fail

**Status:** Works (code).
A code lasts ten minutes and takes five tries ([a vendor signs in before they have applied](../rules/a-vendor-signs-in-before-applying.md)).
A wrong code reads "That code isn't right. Check you typed the newest code and try again.", and the field clears for another.
After the fifth wrong try, or once the code has expired or been replaced, the step reads "That code no longer works. Send yourself a new code.", the field and "Sign in" go, and "Send a new code" is its one action.
"Code already sent - retry in Ns", "Resend code in 60s" and "Send a new code in Ns" pace requests; neither refusal reveals whether an address applied.
Covered by:
- `a-sign-in-code-takes-five-tries.spec.ts`
- `applicant.spec.ts`

### H3e. A Google Form market's public pages

**Status:** Works (walked live; the vendor page read from the code as of T202).
`/<slug>` of a market whose vendors apply on the organizer's own Google Form answers exactly as for a market that does not exist; the vendor page says the page does not exist rather than taking an address ([a gated market answers as absent](../rules/a-gated-market-answers-as-absent.md)).
Covered by:
- `intake-mode.spec.ts`

## The rules it obeys

- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md).
- [A gated market answers as absent](../rules/a-gated-market-answers-as-absent.md).
- [A vendor signs in before they have applied](../rules/a-vendor-signs-in-before-applying.md).
- [An applicant never reads a verdict early](../rules/an-applicant-never-reads-a-verdict-early.md).
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md).

Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
