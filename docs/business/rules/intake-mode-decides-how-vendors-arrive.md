---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#save_plan
  - back-end/market_documents.py#market_serves_applicants
  - front-end/src/components/elements/ElementIntakeMode.vue
verified: 2026-10-22
sources:
  - wayfinding/v0-1-0/06
  - E03/F02
  - E18/F04/S01
  - E31/F03/S04
---

# Intake mode decides how vendors arrive

Every market takes its vendors one way, its intake mode: `csv`, imported by the organizer from the responses their own Google Form collected, or `form`, applying on the market's own page; exactly one, chosen when the market is created and fixed once it leaves draft.
The mode decides who fills the application form in, never whether there is one, and never who may check in on the day.

## Why

The phase cannot say this: a CSV market passes through `applications_open` too, because that is where its import happens, so without a mode its public application form would be live and taking applications from strangers the organizer has no way to answer.
Switching the mode mid-lifecycle strands what the previous mode produced: flip a form market to CSV after people applied, and their pages go dark.
An absent mode is CSV, so the applicant surface fails closed ([ADR 0006](../../adr/0006-intake-mode-fails-closed.md)).

**Each path has its own ways in.**
Importing is the CSV path's in every phase (E31/F03/S04): a form market takes its applications on its own page, so nothing is imported into it.
Publish Results is the form path's: a CSV market's vendors never see this product, so it has no applicants to tell ([Publish Results waits for the allocation](publish-results-waits-for-the-allocation.md)).

**Intake mode does not gate the form builder.**
A CSV market still has an application form, because the essential questions define the offering the CSV maps onto: its form tab is the questions its imports are mapped onto.

**Intake mode does not gate check-in.**
Check-in must stay open to every market that runs: how a vendor entered has no bearing on whether they can scan in on the day ([attendance and the door](../../implementation/modules/attendance-and-door.md)).

## Who may

Whoever creates a market picks its path in the create dialog (`NewMarketOverlay.vue` sends `intakeMode` with `POST /markets`).
After that an Editor changes it on Market Setup while the market is a draft, through the plan write; importing and Publish Results are Admin's ([what each role may do](what-each-role-may-do.md)).

## Where it is kept

- [`intake_mode_from_market_document`](../../../back-end/datatypes.py) is the one reader; the field is `intakeMode` on [the market document](../../implementation/data/market-document.md#the-fields-that-matter).
- **It is settable only while the market is a draft**, through the plan write (`PUT /markets/:id/plan`, `save_plan` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)), whose `prepared_plan` refuses a change after that.
  The refusal is derived from the stored phase rather than from a list of late phases; a body restating the stored mode is not a change, since the plan saves itself in every phase.
- The control is [`ElementIntakeMode.vue`](../../../front-end/src/components/elements/ElementIntakeMode.vue), a plan card; the server is the authority, so a hidden or disabled control is never the rule.
- `market_serves_applicants` in [`back-end/market_documents.py`](../../../back-end/market_documents.py) is the one statement of "this market has an applicant surface", read by the applicant lookup and by `publish_results` ([a gated market answers as absent](a-gated-market-answers-as-absent.md)).
- `import_refusal` in [the CSV import](../../implementation/modules/csv-import.md) refuses a form market, and its words name the CSV rail's moves ("Import responses", "Import more responses").
- `back-end/tests/test_market_intake_mode.py` pins the default, the one writer and the freeze.

## Superseded

The mode was first withheld from organizers through MVP, on the grounds that a toggle would advertise a surface MVP withheld.
That was retired by E18/F04/S01, because the applicant surface turned out to be built and switched off rather than absent, and the apply page already answers correctly in every phase.
