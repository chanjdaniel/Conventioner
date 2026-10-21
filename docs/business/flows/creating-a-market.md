---
layer: business
kind: flow
describes:
  - front-end/src/views/NewMarketOverlay.vue
verified: 2026-10-22
sources:
  - E24/F03
  - E26/F08
  - E31/F03/S01
  - bug/42
  - bug/46
---

# Creating a market

**Who:** an organizer in at least one organization; whoever creates a market is its owner.
**Where they start:** the Markets list's "New market", which opens the create-market dialog, [`NewMarketOverlay.vue`](../../../front-end/src/views/NewMarketOverlay.vue).
**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md) and [Vendors apply on the market's own page](../intents/vendors-apply-on-the-markets-own-page.md).

The dialog asks three things, and "Create market" stays disabled until all three are answered: **Organization**, **Market name**, and **How will vendors apply?**, which starts with nothing chosen.
The answer to the third puts the market on its path from its first screen ([intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md)):

- "On this market's own page": "Plan the market and write its application form here; vendors apply on its page." It lands on Market Setup.
- "On my own Google Form": "You import its responses. Upload them now, and we'll set up the plan and the form from them." It lands on the upload step of the start from a Google Form ([G3](starting-from-a-google-form.md#g3-upload-and-the-year-question)).

The answer stays changeable on Market Setup while the market is a draft ([E5](planning.md#e5-how-vendors-apply)).

## D1. Create a market from scratch

**Status:** Works (walked live; the path question read from the code as of E31/F03/S01 and `where-a-form-starts.spec.ts`).
**Task:** "Start a new market called Winter Market 2026."

1. `/markets`, "New market".
2. The dialog "Create new market" asks for **Organization**, **Market name** and **How will vendors apply?**.
3. Enter a name, choose "On this market's own page", and choose "Create market" (Enter also submits).
4. Expect `/markets/<id>/setup` in Draft, with the market bar (Market Setup, Application Form, Applications, Assignment, Attendance) and the phase rail.

An empty name, or no answer to how vendors apply, keeps "Create market" disabled.
On the Google Form path the same dialog ends on the upload step instead; "Cancel" there leaves a Google Form draft on Market Setup to plan by hand, and its form tab reads "Questions" ([P1](the-google-form-path.md#p1-csv-intake-form-built-by-hand)).
Covered by: `new-market-org.spec.ts`, `dialog-idiom.spec.ts`, `where-a-form-starts.spec.ts`.

## D2. Create a market that starts from a Google Form

**Status:** Works (re-walked live on 2026-10-03, as P2; the choice's wording read from the code as of E31/F03/S01).
As D1, choosing "On my own Google Form"; lands on `/markets/<id>/start-from-csv` (flow [G](starting-from-a-google-form.md)).
Covered by: `where-a-form-starts.spec.ts`.

## D3. Choose among several organizations

**Status:** Works (walked live).
With more than one organization the Organization field is a dropdown starting on "Select organization", and "Create market" stays disabled until one is chosen; with exactly one it is plain text.
Covered by: `dialog-idiom.spec.ts` ("with exactly one organization"), `new-market-org.spec.ts`.

## D4. Create a market with no organization yet

**Status:** Works (walked live).
With none, the dialog says "No organizations available. Create an organization" and keeps "Create market" disabled.
The link goes to `/organizations` (the dialog and anything typed in it are lost); after creating an organization there, start again from "New market".
The dashboard says the same: create the organization under Organizations first (bug 42).
Covered by: `new-market-org.spec.ts` (the zero-organization user).

## D5. A name that is already someone's address

**Status:** Works (walked live): "Another market already uses the web address /pier-draft-market. Choose a name that is different in more than accents or punctuation."
The name becomes the public URL slug, so a name whose slug is taken is refused, look-alikes included ("Cafe Market" beside "Café Market"); see [the slug](../../implementation/data/market-document.md#the-slug).
Covered by: `public-address.spec.ts`.

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
