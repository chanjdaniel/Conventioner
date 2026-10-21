---
layer: business
kind: flow
verified: 2026-10-21
sources:
  - E31/F03/S04
  - E32/F03/S01
---

# The mixed path

A path is one way of running a market from start to finish; this one would take applications on the market's own page and also import stragglers collected elsewhere.
**Who:** the organizer, and vendors applying online.
**Where they start:** as [the online path](the-online-path.md).
**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md) and [Vendors apply on the market's own page](../intents/vendors-apply-on-the-markets-own-page.md).

## P4. Mixed intake: online form plus imported stragglers

**Status:** Not offered (read from the code as of E36: `import_refusal` in [`back-end/csv_import.py`](../../../back-end/csv_import.py); `what-to-show-and-when.spec.ts`, "past draft the setup is settled, and a form market imports nothing").
A market takes its vendors one way, chosen in draft, and since E31/F03/S04 each path offers only its own actions.
A market whose vendors apply on its own page shows no import, and the server refuses one: "This market takes applications on its own page, so nothing is imported into it."
A market whose vendors are imported has no applicant pages at all, so an imported vendor has nothing to sign in to: since E32/F03/S01 even its sign-in page reads as a market that does not exist.

What each step of the path does now:

| Step | Flows | Now |
| --- | --- | --- |
| As [P3](the-online-path.md#p3-online-intake-vendors-apply-on-the-markets-page) through opening applications | [D1](creating-a-market.md#d1-create-a-market-from-scratch), [E](planning.md), [F](form-tab.md), [H1](taking-applications.md#h1-open-applications) | Works, as P3 |
| Import applications collected elsewhere | [H2a](import.md#h2a-first-import-everything-maps) | Refused on a market whose vendors apply on its page |
| Vendors sign in and edit | [H3b](applying-online.md#h3b-a-returning-vendor-edits-their-application), [H3c](applying-online.md#h3c-a-vendor-checks-their-application) | Works for the market's own applicants only |
| Everything after | as P3 | Works, as P3 |

## The rules it obeys

- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): exactly one way in, and importing is the Google Form path's.
- [A gated market answers as absent](../rules/a-gated-market-answers-as-absent.md): an imported market's applicant pages read as no market at all.

Its specs are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
