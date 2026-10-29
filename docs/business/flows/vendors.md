---
layer: business
kind: flow
describes:
  - front-end/src/views/VendorsView.vue
verified: 2026-10-29
sources:
  - wayfinding/claims-and-room/04
  - wayfinding/rejection-visibility/02
  - E11/F04
  - E26/F05/S04
  - E35/F01/S01
  - E36/F02/S04
  - E36/F03/S01
  - bug/10
  - bug/33
  - E28/F02/S02
---

# Vendors

**Who:** anyone who can read the market; placing and adding are an Editor's ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Vendors page, the Assignment tab's third page, or the Result page's "N unassigned".
**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

The Vendors page ([`VendorsView.vue`](../../../front-end/src/views/VendorsView.vue)) lists every applicant of the market, one row each, and a row opens that vendor's [drawer](vendor-drawer.md); what the page counts is the vendors the run places.

## J11. Browse by vendor

**Status:** Works (re-walked live on 2026-10-03; every applicant listed, and the filters, read from the code as of E36/F02/S04 and E36/F03/S01: `vendors-and-limits.spec.ts`, `placing-someone-not-approved.spec.ts`).

1. "Search vendors" ("Filter by name or email…") finds a vendor by name or address; each row names the vendor, with their address beside.
2. "N of M vendors assigned" counts the vendors the run places, the approved applicants (bug 10); a filter or search reads "N of M vendors shown".
3. Each row in the run shows Assigned or Unassigned and "N of M dates", against the dates they could have had; a rejected applicant shows "Rejected", and a vendor added by hand "Added".
4. "Unassigned only", and "Rejected only" when anyone was rejected, narrow the list, each cleared with its "×"; the Result page's filters (Date, Section, Tier, Table) narrow it to where vendors are placed, and are kept across the two pages.
5. The Result page's "N unassigned" link opens this list filtered, as "Unassigned only".

Before a run the page lists the vendors and says nothing is assigned yet.
Covered by: `vendors.spec.ts`, `vendors-and-limits.spec.ts`, `placing-someone-not-approved.spec.ts`.

**Adding a vendor who never applied.**
From Assignment on, "Add a vendor" opens "Add a vendor": "For someone who never applied. They are added as approved, and you seat them on the Result page.", with Name and Email; "Add vendor".
They are listed as "Added", offered under "Added by hand" in the place dialog ([J6](placing-by-hand.md#j6-place-a-vendor-in-an-empty-seat)), and never placed by a run ([adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md)).
Covered by: `adding-a-vendor.spec.ts`.

## J12. Find out why a vendor was not placed

**Status:** Works (walked live); a vendor at their date limit, or at the market's ceiling, is told so (bug 33).
On the drawer's Assignments tab each date the vendor did not get states why, in words: "Not available on this date", "Already has as many dates as they asked for", "Already has as many dates as the market allows per vendor", "No table at a tier they accept", "Every table they accept is taken", or "A table is free - they could be placed".
Only the last offers "Place them", which opens the Result page on that date, searched for them; a date stopped by a limit offers no placing.
Covered by: `vendors.spec.ts` ("an unplaced vendor is opened from the payoff screen and told why"), `vendors-and-limits.spec.ts`.

## Superseded

- The page was to list only the vendors the run places, a rejected applicant leaving it, so that it and the Result page counted the same people by construction (wayfinding/claims-and-room/04, E26/F05/S04).
  It lists every applicant, so a rejected one can be found and seated by hand, and only its count is the run's vendors, the people the Result page counts (E36/F02/S04).

## The rules it obeys

- [A seat only for an applicant](../rules/a-seat-only-for-an-applicant.md): every applicant is listed, and may be seated.
- [Adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md).
- [Why a vendor was not placed](../rules/why-a-vendor-was-not-placed.md): the reasons a date was not given, and which one offers a seat.
- [The ceiling on dates per vendor](../rules/max-assignments-ceiling.md) and [tier filters, section prefers](../rules/tier-filters-section-prefers.md): the limits two of those reasons name.

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
