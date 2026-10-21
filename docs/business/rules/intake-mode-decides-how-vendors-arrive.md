---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#save_plan
  - back-end/market_documents.py#market_serves_applicants
  - front-end/src/components/elements/ElementIntakeMode.vue
verified: 2026-10-21
sources:
  - wayfinding/v0-1-0/map
  - wayfinding/v0-1-0/06
  - wayfinding/real-market-readiness/05
  - wayfinding/the-order-of-the-work/09
  - wayfinding/what-to-show-and-when/02
  - E03/F02
  - E18/F04/S01
  - E31/F03
  - E31/F03/S04
  - E32/F02
  - E03
---

# Intake mode decides how vendors arrive

Every market takes its vendors one way, its intake mode: `csv`, imported by the organizer from the responses their own Google Form collected, or `form`, applying on the market's own page; exactly one, chosen when the market is created and fixed once it leaves draft.
The mode decides who fills the application form in, never whether there is one, and never who may check in on the day.

**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md) and [Vendors apply on the market's own page](../intents/vendors-apply-on-the-markets-own-page.md).

## Why

The phase cannot say this: a CSV market passes through `applications_open` too, because that is where its import happens, so without a mode its public application form would be live and taking applications from strangers the organizer has no way to answer.
Switching the mode mid-lifecycle strands what the previous mode produced: flip a form market to CSV after people applied, and their pages go dark.
**A market taken back to draft may change its mode again**, and that is safe: the way back is open only while nobody has applied ([the form locks at the first application](the-form-locks-at-the-first-application.md)), so nothing yet depends on how vendors were going to arrive, and its applicant pages close on the way back, as a draft's are.
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
The dialog chooses nothing for them, so no new market relies on the server's default; the default stays for any market without an answer ([ADR 0006](../../adr/0006-intake-mode-fails-closed.md)).
After that an Editor changes it on Market Setup while the market is a draft, through the plan write; importing and Publish Results are Admin's ([what each role may do](what-each-role-may-do.md)).

## Where it is kept

- [`intake_mode_from_market_document`](../../../back-end/datatypes.py) is the one reader; the field is `intakeMode` on [the market document](../../implementation/data/market-document.md#the-fields-that-matter).
- **It is settable only while the market is a draft**, through the plan write (`PUT /markets/:id/plan`, `save_plan` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)), whose `prepared_plan` refuses a change after that.
  The refusal is derived from the stored phase rather than from a list of late phases; a body restating the stored mode is not a change, since the plan saves itself in every phase.
- The control is [`ElementIntakeMode.vue`](../../../front-end/src/components/elements/ElementIntakeMode.vue), a plan card; the server is the authority, so a hidden or disabled control is never the rule.
- `market_serves_applicants` in [`back-end/market_documents.py`](../../../back-end/market_documents.py) is the one statement of "this market has an applicant surface", read by the applicant lookup and by `publish_results` ([a gated market answers as absent](a-gated-market-answers-as-absent.md)).
- `import_refusal` in [the CSV import](../../implementation/modules/csv-import.md) refuses a form market, and its words name the CSV rail's moves ("Import responses", "Import more responses").
- An application does not record how it arrived: the market's mode already says, so a field on the application would be a second copy ([ADR 0011](../../adr/0011-re-import-upserts-on-market-and-email.md)).
- `back-end/tests/test_market_intake_mode.py` pins the default, the one writer and the freeze.

## Superseded

The product first took vendors by CSV import only, as a temporary intake until the online form became the official path (`wayfinding/v0-1-0/map`).
Both are now paths a market chooses between when it is created, and the Google Form path is a whole path of its own, with its own rail (E31/F03, E32/F02).

The mode was first withheld from organizers through MVP, on the grounds that a toggle would advertise a surface MVP withheld.
That was retired by E18/F04/S01 (wayfinding/the-order-of-the-work/09), because the applicant surface turned out to be built and switched off rather than absent, and the apply page already answers correctly in every phase.
