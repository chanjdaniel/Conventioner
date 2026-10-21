---
layer: implementation
kind: adr
describes:
  - back-end/datatypes.py#IntakeMode
  - back-end/datatypes.py#intake_mode_from_market_document
verified: 2026-10-22
sources:
  - wayfinding/v0-1-0/06
  - wayfinding/v0-1-0/07
  - E03/F02
  - E03/F02/S01
  - E03/F02/S02
status: accepted
---

# Intake mode fails closed

## Context

A market's vendors reach it one of two ways: the organizer imports the responses their own Google Form collected, or vendors apply on the market's own page.
The phase cannot tell the two apart.
Applying is already gated to `applications_open`, but a CSV market passes through that phase too, because that is where the import happens, so during that window its public application form would be live and taking applications from strangers the organizer has no way to answer.
So a market needs a field of its own saying which way it takes vendors, and every market already stored had no such field.

Whatever a missing value means, one mistake is possible for every existing market.
Wrongly hiding an application surface is visible and gets complained about; wrongly exposing one is silent until a stranger applies.
The phase had already taught the same lesson: `Market.phase` defaulting to `draft` silently mislabelled every market written before the field existed ([the market document](../implementation/data/market-document.md#parsing-a-stored-market)).

## Decision

**`Market.intake_mode` is `csv` or `form`, exactly one, and absence means `csv`, so the public applicant surface fails closed.**

- [`intake_mode_from_market_document`](../../back-end/datatypes.py) is the one reader: an absent, blank or unrecognized `intakeMode` reads as `IntakeMode.CSV`, logged when unrecognized rather than raised, so one bad document cannot take down a list.
- **There is no migration and no backfill, and none is needed**: the reader's answer for a document with no field is the answer the product wants for it.
- A market gated by its intake mode answers exactly as a market that does not exist ([a gated market answers as absent](../business/rules/a-gated-market-answers-as-absent.md)).
- What the mode governs, and when it may change, is [intake mode decides how vendors arrive](../business/rules/intake-mode-decides-how-vendors-arrive.md).

## Consequences

- **Any fixture whose market serves applicants must say `intakeMode: "form"`**, in pytest and in the E2E seeds alike.
  A fixture that does not is a market whose applicant endpoints answer 404, which is the default doing its job.
  `seedApplicantMarket` ([`front-end/e2e/helpers/seedApplicantMarket.ts`](../../front-end/e2e/helpers/seedApplicantMarket.ts)) makes a form market unless told otherwise; `seedPublishedMarketWithAssignments` ([`front-end/e2e/helpers/seeds.ts`](../../front-end/e2e/helpers/seeds.ts)) and the back end's `stored_market` (`back-end/tests/conftest.py`) make a CSV market unless told otherwise.
- **Reading degrades; it does not write.**
  A market nobody edits keeps whatever it stores; the next write persists the effective value, so an unrecognized one becomes `csv` then, which is the repair rather than a loss.
- `intakeMode` is the only spelling read, because it is the only spelling written: the field is newer than the camelCase convention, so no stored document can carry another.
- **A projection must carry the field.** A lookup that projects a market without `intakeMode` reads it as CSV, so every form market would look gated; `applicant_intake_market_by_slug` adds it to its caller's fields rather than expecting it there.
- The model never parses the field: `market_from_document` withholds it from Pydantic and takes it from the reader, since an enum is validated on construction ([the market document](../implementation/data/market-document.md#parsing-a-stored-market)).
- The front end reads the mode the same way: `intakeModeOf` in [the market guide](../implementation/modules/market-guide.md) takes an absent mode as CSV.
- A third value (both at once) can be added later without disturbing either of these two.

## Considered and rejected

- **Absence means `form`**, which would have matched the applicant surface being built: every market stored before the field would have had a live public form it never chose.
- **A migration writing `csv` onto every stored market**: it decides nothing the reader does not, and a market written by an older build after it ran would be ungated again.
- **Both at once** (importing some vendors while others apply online): nothing needed it, and it makes an imported row and an online application for one address collide.
- **A friendly "not accepting applications online" page for a gated market**: it confirms to any stranger guessing slugs that the market is real, which is the leak the fail-closed default exists to prevent.
