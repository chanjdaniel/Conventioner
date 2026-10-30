---
layer: business
kind: rule
describes:
  - back-end/essential_fields.py#display_name
  - back-end/api/applications.py#vendor_names_for_market
  - front-end/src/utils/vendorIdentity.ts
  - front-end/src/components/VendorIdentity.vue
verified: 2026-10-30
sources:
  - wayfinding/readable-journey/02
  - wayfinding/the-order-of-the-work/04
  - E13
  - E19/F02/S01
  - E35/F03/S02
  - E19
  - E38/F03/S01
  - T123
---

# A vendor is called by their chosen name

Every screen that names a vendor leads with the name they chose, else the name on their identification, and shows their email address beside it; never the name instead of the address.
A vendor whose application holds no name is shown by their address alone, exactly as every screen showed vendors before names existed.

**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md) and [The door on market day](../intents/the-door-on-market-day.md).

## Why

**The name is what people read; the address is what the product matches on.**
Two vendors can share a name, while the address is unique, always present, what check-in matches on and what ties a vendor back to their application, so it is never dropped for the name.
At a door someone is reading it off a phone.

**Nobody is labelled "Unnamed vendor".**
Names arrived after markets had applications, so a market whose applications carry none must look no worse than it did; the fallback to the address is that floor.

**The name is one field, a person's.**
The names organizers already collect arrive whole (a Google Form's "Full Legal Name" question holds a whole name in one answer), so a first-and-last split would guess, and get every "van der Berg" wrong.
A trading name is not an essential question; an organizer who wants one asks it as their own question, and the search on the results finds a short text answer too.

**The name is essential because identity is, not because the solver reads it.**
The full name is asked of every market unconditionally and required on every new save; the preferred name is asked of everyone and never required.
Neither is solver-relevant, so correcting a spelling reopens no review, and the solver names the answers it reads, so an application stored before names existed still assigns with no migration ([essential fields](../../implementation/modules/essential-fields.md)).

**The review card shows both names, labelled**, since deciding about a person is not scanning a list.
The results download carries both too: the name they chose, then their full name, then the address.

**A search finds a vendor by name or address**: the Vendors page reads "Filter by name or email…", and the search on the results also matches their short text answers.

## Where it is kept

- `display_name` in [`back-end/essential_fields.py`](../../../back-end/essential_fields.py) is the one statement of which name: the preferred name if given, else the full name.
  [Essential fields](../../implementation/modules/essential-fields.md) owns both questions and their validation.
- `vendor_names_for_market` in [`back-end/api/applications.py`](../../../back-end/api/applications.py) serves it as `vendorNames`, address to name, lowercased, and only for applications that hold a name; [the application document](../../implementation/data/application-document.md) is where the answers live.
- [`front-end/src/components/VendorIdentity.vue`](../../../front-end/src/components/VendorIdentity.vue) draws the name over the address on every screen that names a vendor from the served names, and [`front-end/src/utils/vendorIdentity.ts`](../../../front-end/src/utils/vendorIdentity.ts) holds the fallback and the search (`vendorHeadline`, `vendorMatches`).
  A screen that holds the answers themselves rather than the served names reads the name with `applicantName` and draws it over the address the same way ([essential fields](../../implementation/modules/essential-fields.md)).
- `back-end/tests/test_preferred_name.py` and `front-end/src/__tests__/vendorIdentity.test.ts` pin it.

## Superseded

- A vendor was to be named by their full name, the one on their identification (wayfinding/readable-journey/02); they are called by the name they chose where they gave one (wayfinding/the-order-of-the-work/04, E19/F02/S01).
