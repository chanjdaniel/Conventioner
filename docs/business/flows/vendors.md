---
layer: business
kind: flow
describes:
  - front-end/src/views/VendorsView.vue
  - front-end/src/components/ExportVendorsDialog.vue
  - front-end/src/utils/vendorExport.ts
  - back-end/api/vendor_export.py
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
  - E42/F01/S01
  - E42/F01/S02
  - E42/F01/S03
---

# Vendors

**Who:** anyone who can read the market; placing and adding are an Editor's, and exporting is anyone's who holds a role ([what each role may do](../rules/what-each-role-may-do.md)).
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
On the drawer's Assignments tab each date the vendor did not get states why, in words: "Not available on this date", "Already has as many dates as they asked for", "Already has as many dates as the market allows per vendor", "No table at a tier they accept", "Every table they accept is taken", or "A table is free - they could be assigned".
Only the last offers "Assign them", which opens the Result page on that date, searched for them; a date stopped by a limit offers no placing.
Covered by: `vendors.spec.ts` ("an unplaced vendor is opened from the payoff screen and told why"), `vendors-and-limits.spec.ts`.

## J15. Export the vendors to a CSV

**Status:** Works (E42/F01/S01, `exporting-vendors.spec.ts`; the placement columns E42/F01/S02, `exporting-placements-by-date.spec.ts`; from the Applications tab E42/F01/S03, `exporting-from-the-applications-tab.spec.ts`).
For a Google Sheet and a mail merge such as YAMM: any of the market's vendors, filtered by what the app knows of them, with the columns chosen.

1. "Export", beside the show-only choices, opens "Export vendors" ([`ExportVendorsDialog.vue`](../../../front-end/src/components/ExportVendorsDialog.vue)) on what the page shows ([`vendorsPageSeed`](../../../front-end/src/utils/vendorExport.ts)): "Unassigned only" as the approved vendors not assigned, on the page's date when one is chosen; "Rejected only" as the rejected; the page's date, section, tier and table size as the vendors assigned there; and the search.
   The Applications tab's All view opens the same dialog on its status filter and Mine ([the All view](review.md#the-all-view), `applicationsAllSeed`).
2. Every filter is shown and may be changed: the name or email searched; the status, any of Open, Needs follow-up, Approved, Rejected and Added by hand, none ticked being any; "Mine: the follow-ups I own", the follow-ups whose owner is the one exporting, as the server reads who asks; assigned or not ("Assigned", "Assigned or not", "Not assigned"), on any date or on one; for the assigned, the seat's section, tier and size; and the options of each of the form's choice questions, any of which the vendor chose.
3. The columns are ticked under three headings: "Vendor" (Name, the full name; Preferred name; Email; Status), "Answers" (each of the form's own questions, the heading left out when it asks none) and "Assignment".
   Name, Email and Status are ticked to begin with.
4. "Assignment" holds, for each market date, where the vendor sits that day: "Wed 18 Nov - table", "- section", "- tier" and "- half or full" (Full table or Half table), empty on a date they hold no seat; then "Dates assigned", how many of the market's dates they hold one on.
   The seats are the stored placements the Result page draws, pins and seats moved by hand included, and a vendor added by hand exports theirs like anyone.
5. "In the file, in this order" lists the ticked columns: a column ticked joins the end, and each is moved by dragging or with its up and down buttons.
6. "N vendors, M columns" and the file's first three rows preview it, and follow every change.
7. "Download CSV" saves one row per vendor, the header the columns as named, a multi-select answer one cell joined by ", ", a box Yes or No. The file is UTF-8 with a byte-order mark, so a spreadsheet reads accents, and is named for the market and the organizer's day, `<market>_vendors_<YYYY-MM-DD>.csv`.

The server builds the file and the preview from the filters the dialog sends ([`vendor_export.py`](../../../back-end/api/vendor_export.py)), so what is exported is what the server holds, and a seat is read from the stored placements the Result page draws.
Every cell is written so a spreadsheet shows it as text: one beginning with `=`, `+`, `-`, `@`, a tab, a carriage return or a newline gains a leading quote, as the assignment's download does.
No column set is saved between exports yet.
Covered by: `exporting-vendors.spec.ts`, `exporting-placements-by-date.spec.ts`, `exporting-from-the-applications-tab.spec.ts`, `back-end/tests/test_exporting_vendors.py`, `exportingVendors.test.ts`.

## Superseded

- The page was to list only the vendors the run places, a rejected applicant leaving it, so that it and the Result page counted the same people by construction (wayfinding/claims-and-room/04, E26/F05/S04).
  It lists every applicant, so a rejected one can be found and seated by hand, and only its count is the run's vendors, the people the Result page counts (E36/F02/S04).

## The rules it obeys

- [A seat only for an applicant](../rules/a-seat-only-for-an-applicant.md): every applicant is listed, and may be seated.
- [Adding a vendor who never applied](../rules/adding-a-vendor-who-never-applied.md).
- [Why a vendor was not placed](../rules/why-a-vendor-was-not-placed.md): the reasons a date was not given, and which one offers a seat.
- [The ceiling on dates per vendor](../rules/max-assignments-ceiling.md) and [tier filters, section prefers](../rules/tier-filters-section-prefers.md): the limits two of those reasons name.

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
