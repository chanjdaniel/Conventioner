---
layer: business
kind: rule
describes:
  - back-end/assignment/assignment.py#MarketAssignment.best_table_for
  - back-end/assignment/assignment.py#MarketAssignment.is_valid_vendor
  - back-end/assignment/vendor_input.py#SolverVendor
verified: 2026-10-21
sources:
  - wayfinding/v0-1-0/01
  - wayfinding/real-market-readiness/02
  - E01/F05
  - E02
  - bug/23
---

# Tier filters, section prefers

A vendor is never placed at a tier they did not accept on that date, even if that leaves them unassigned.
A vendor's section ranking is a preference: they get their highest-ranked section still open, and are never left unassigned because a preferred section filled up.

**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md) and [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

## Why

**Tier is a filter because it sets the price**: what a vendor pays for a table on a given day follows from its tier, so placing them at one they refused charges them for something they did not agree to.
It is answered per date, because a vendor who offered Gold on Monday and only Bronze on Friday must not be placed at Gold on Friday.
A real Google Form asks it per day and promises the applicant, in writing, "the highest tier available among the selections made" for that day; one set of tiers for the whole market, the union of the days, would let the solver break that promise and charge for it.
A tier is matched by name, as set membership; the spreadsheet era's substring test let a tier named `A` match an answer of `AB`.

**Availability stays an answer of its own**, beside the tiers: "who can come on Tuesday" is a question a market with no tiers still asks.
The two must agree, so an application is refused when a date it is available carries no tier, or a date it is not available carries one; either repair would invent an answer.
A per-date answer has no order, so the tier preference is never a priority rule's target.

**Section is a preference because a ranking excludes nothing**: an applicant ranks every section the market offers, so an unranked section sorts behind every ranked one rather than being refused, and nobody goes unplaced for wanting something.

**A vendor never asked about tiers takes any tier**: their answer is empty because the form froze before the market had tiers, not because they refused any (bug 23).
A table with no tier constrains nobody.
An applicant who was asked and answered nothing is not placed anywhere: the run refuses them ([an incomplete application refuses the run](an-incomplete-application-refuses-the-run.md)).

**A tier the market no longer offers** is dropped from the answers that named it, so a vendor left accepting no tier on a date is unplaceable there and reported unassigned, rather than the market becoming unassignable.

## Where it is kept

- `is_valid_vendor` in [`back-end/assignment/assignment.py`](../../../back-end/assignment/assignment.py) applies the tier filter, through `SolverVendor.accepts_tier_on` in [`back-end/assignment/vendor_input.py`](../../../back-end/assignment/vendor_input.py).
- `best_table_for` picks, among the tables that pass it, the one in the vendor's best-ranked section; among tables of equal rank, a half-empty table before an empty one, then the plan's table order, so a re-run places the same way.
  It is why placement is vendor-driven: a table-driven loop could not let a vendor's ranking choose ([the assignment solver](../../implementation/modules/assignment-solver.md)).
- Priority comes first: a preferred section never puts a vendor ahead of someone the rules place before them.
- The answers' shapes, a set of tiers per date and a total ranking of sections, are [essential fields](../../implementation/modules/essential-fields.md), decided in [essential fields are exactly what the solver reads](../../adr/0001-essential-fields-are-the-solver-contract.md).
  The per-date answer keeps the key `essential_tier_preference` with a new shape, a date to its list of tiers; `migrate_tier_preference_per_date.py` gave each stored flat answer those tiers on every date the vendor was available, with no boot marker, since an unmigrated answer refuses the run by name.
- The cases are `TestTierIsAFilterOnlyWhenAsked` and `TestSectionPreference` in [the assignment behaviour suite](../../implementation/testing/assignment-behaviour-suite.md).
