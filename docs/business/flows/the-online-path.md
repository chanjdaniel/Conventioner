---
layer: business
kind: flow
verified: 2026-10-21
sources:
  - E18/F04
  - E26/F07
  - E31/F03/S01
  - E36/F04
  - E36/F05
  - bug/6
  - bug/20
  - bug/21
  - bug/36
---

# The online path

A path is one way of running a market from start to finish; on this one vendors apply on the market's own page, and the organizer reviews them there.
**Who:** the organizer, signed in, in an organization; and the vendors applying, who need no account.
**Where they start:** the organizer on the Markets list; a vendor on the application link the organizer shares.
**Serves:** [Vendors apply on the market's own page](../intents/vendors-apply-on-the-markets-own-page.md) and [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

## P3. Online intake: vendors apply on the market's page

**Task (organizer):** "Vendors should apply on your market's own page this year. Set that up and share the link."
**Task (vendor):** "Apply to Harbour Night Market for both dates, then check whether you got in."

**Status:** Works (re-walked live on 2026-10-03; the result a vendor reads changed since, read from the code as of E36: `front-end/src/utils/applicantOutcome.ts`, `results-wait-for-the-allocation.spec.ts`).
On the re-walk a vendor who had never applied signed in with an emailed code, applied, and stayed signed in across a reload (bugs 6, 20, 21 and 36).
Since E36/F04 the organizer publishes results in Assignment, once a current run is stored, and publishing settles the run; the market cannot be published until they have.
Since E36/F05 a vendor reads "Submitted" until then, and afterwards "You have a table" or "You did not get assigned", never a verdict or a reason.
Only this path's market has applicant pages, so a vendor brought in by an import has none to sign in to ([the mixed path](the-mixed-path.md)).

| Step | Flows |
| --- | --- |
| Create the market, choosing "On this market's own page", and plan it | [D1](creating-a-market.md#d1-create-a-market-from-scratch), [E1 to E4](planning.md) |
| Build the form, preview it as an applicant sees it, and set up the review | [F1 to F3](form-tab.md) |
| Open applications and share the application page's link from the rail | [H1](taking-applications.md#h1-open-applications) |
| Vendors sign in with an emailed code, apply, and can edit while applications are open | [H3a to H3d](applying-online.md) |
| Close applications and review | [H4](taking-applications.md#h4-close-applications), [I4](review.md#i4-begin-review), [I1 to I3](review.md), [I5](review.md#i5-begin-assignment) |
| Run the assignment and adjust it | [J1 to J5](assignment-and-result.md), [J6 to J10 and J13](placing-by-hand.md), [J11 and J12](vendors.md) |
| Publish results, so vendors read whether they have a table | [I7](assignment-and-result.md#i7-publish-results), [H3c](applying-online.md#h3c-a-vendor-checks-their-application) |
| Publish the market, run market day, end it | [K](market-day-door.md), [L](ending-and-managing-a-market.md) as in [P1](the-google-form-path.md#p1-csv-intake-form-built-by-hand) |

## The rules it obeys

- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md).
- [A vendor signs in before they have applied](../rules/a-vendor-signs-in-before-applying.md).
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md).
- [Publish Results waits for the allocation](../rules/publish-results-waits-for-the-allocation.md).
- [An applicant never reads a verdict early](../rules/an-applicant-never-reads-a-verdict-early.md).

The lifecycle it walks is [the lifecycle](lifecycle.md); its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
