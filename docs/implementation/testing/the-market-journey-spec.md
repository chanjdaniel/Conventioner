---
layer: implementation
kind: testing
describes:
  - front-end/e2e/market-journey.spec.ts
verified: 2026-10-29
sources:
  - wayfinding/v0-1-0/map
  - E03/F02/S04
  - E04/F01/S02
  - E32/F02/S01
  - E36/F04/S02
  - E38/F04/S01
  - E38/F05/S01
---

# The market journey spec

**One spec walks the whole journey; every other spec is a slice.**
[`market-journey.spec.ts`](../../../front-end/e2e/market-journey.spec.ts) is the only spec that goes create, plan, import, review, assign in a single organizer session, entirely through the UI, and asserts who got a table and who did not.
It seeds only what precedes the journey, a verified user and an organization.
It is the release's acceptance test: if it fails, the product does not do what it claims.
The journey is proven by this one continuous walk rather than by auditing the slices for gaps, because slices that each pass can miss the seam between them: publishing once landed a CSV market's organizer on a page their own market answered "not found" to, and no slice saw it (E03/F02/S04).

The glossary concept: [Market](../../business/concepts/market.md).

## What it walks

1. Create a market whose vendors apply on the organizer's own Google Form, and leave its upload step for Market Setup.
2. Plan it on the one page: two dates still to come, a tier, two sections, a location.
3. Leave draft by importing: on the CSV path the rail reads Draft, Review ([the phase rail](../modules/phase-rail.md)), and its main button "Import responses" opens the import, with Begin Review disabled beside it.
4. Import a Google Forms export that asks only the essential questions, which is the ordinary case: an organizer who never built a custom form.
5. The written import takes the market into Review; "Go to the review", switch from the All view the page opens on to One by one, and approve two applicants and reject one in the review queue, checking that the card carries the answers a verdict rests on.
6. Begin Assignment and run it.
7. Read the result: the two approved hold tables and the rejected one holds none, read off the drawn grid so "not placed" is not "not loaded".

Approval is what decides the solver's whole input, which is why the journey must click it.
It stops at the result: publishing and market day are the slices'.

A second test walks the online path to the same seam: a market whose vendors apply on its own page is created and planned, opens applications, a vendor applies on its page in a browser of their own, the organizer approves them in the same stage, One by one, begins assignment and runs it, and the vendor holds a table ([ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)).

## The slices

Each other spec seeds past some part of the journey, and the slices overlap rather than meet:

- `market-pipeline.spec.ts` creates the market over the API and seeds applications already approved, then walks the phases on the rail to `assignment`, assigns, reads the result and publishes to `market_days`, checking the public check-in page finds a vendor; it imports and reviews nothing.
- `csv-import.spec.ts` covers the import in depth on a market seeded over the API, and ends at "rows are applications awaiting review", asserted over the API.
- Review behaviour has specs of its own that click Approve on seeded applications (`needs-a-follow-up`, `a-late-export`, `what-to-show-and-when`, `automatic-rejections`), but none of them reaches the run from a verdict it made.
- Any spec built on [`seedMarketWithVendors()`](e2e-seeds.md#the-seed-helpers) starts from approved vendors, and exercises no review at all.

## Deciding where a test belongs

Before adding a test, decide which spec it extends: the journey, or one of the slices.
**If the answer is "the seam between two of them", it belongs in the journey spec**, because the seam is what no slice crosses: nothing joined the import's end to the pipeline's start until this spec did.
A test about one step in depth belongs in that step's slice, seeded past everything before it ([E2E seeds](e2e-seeds.md)).
