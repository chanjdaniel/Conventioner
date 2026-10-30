---
layer: business
kind: rule
describes:
  - back-end/api/applicants.py#publish_results_refusal
  - back-end/api/applicants.py#publish_results
  - back-end/result_outcome.py
  - back-end/guards.py#ResultsPublishedGuard
  - back-end/app.py#publish_market_results
verified: 2026-10-30
sources:
  - wayfinding/readable-journey/01
  - wayfinding/rejection-visibility/02
  - wayfinding/rejection-visibility/map
  - wayfinding/what-to-show-and-when/02
  - E36/F04
  - E36/F04/S01
  - E36/F04/S02
---

# Publish Results waits for the allocation

A market whose vendors apply on its page publishes its results in `assignment`, once an assignment is stored and current, and only then; publishing settles that assignment, and the market goes live only after it.
A market that imports its vendors has no applicants to tell, so it has neither the publish nor the wait ([intake mode decides how vendors arrive](intake-mode-decides-how-vendors-arrive.md)).

**Serves:** [Results go out once, and settle the allocation](../intents/results-go-out-once-and-settle-the-allocation.md).

## Why

Results tell each applicant whether they have a table, so they can be told only once the seats exist; and once told, nobody's answer may shift under them through a later run.
Before E36 results could be published on a market with nothing reviewed and nothing assigned, and a market could go live with its applicants still reading "Submitted".
Publishing results stays its own act, never part of going live; the decision and what it costs are [ADR 0013](../../adr/0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md).

**Publishing settles the allocation.**
After it the run is refused (`assign_refusal`, served as `assignRefusalReason`) and [the assignment rules](the-assignment-rules-close-with-the-assignment.md) lock; a single seat is still changed by hand on the Assignments page.
There is no unpublish: nothing writes `resultsPublished` back to false.

**The market does not go live first.**
`ResultsPublishedGuard` is an entry invariant on `market_days`, so a form market cannot publish its check-in page until its applicants have been told; a CSV market passes it.

**The outcome is read off the stored seats, never the verdict.**
An applicant seated on any date has a table; everyone else (rejected, or approved and not placed) reads "You did not get assigned", with no reason (`back-end/result_outcome.py`).
The publish confirmation counts both by that same rule (`publishOutcomes`), counting main applications only.

## Who may

An ADMIN or the owner, as with every action that tells people outside the market; never on an archived market.

## Where it is kept

- `publish_results_refusal` in [`back-end/api/applicants.py`](../../../back-end/api/applicants.py) says the rule: refused on a CSV market, once already published, outside `assignment`, with nothing stored, or with the stored run [out of date](an-assignment-knows-when-it-is-out-of-date.md).
  `publish_results` asks it and sets `resultsPublished`; `POST /markets/:id/publish-results` ([`publish_market_results`](../../../back-end/app.py)) asks the table's Publish results row ([the market's actions](../../implementation/modules/market-actions.md)), ADMIN by default, and the archived rule first.
- The market read serves who may, the table's Publish results answer in `actionRefusals`, and this rule apart, as `publishWaitsReason`, and the counts as `publishOutcomes` only while neither refuses; the review shows the button to whoever may publish, disabled with the rule's words while it refuses, so it is offered exactly when the endpoint would take it.
- [`back-end/result_outcome.py`](../../../back-end/result_outcome.py) is the one reading of who has a table, for the confirmation and for the applicant's page.
- `ResultsPublishedGuard` in [`back-end/guards.py`](../../../back-end/guards.py), kept by [the guards](../../implementation/modules/guards.md); whether the run is current is [what it was made from](../../implementation/modules/made-from.md).
- `back-end/tests/test_publishing_settles_the_assignment.py` and `front-end/e2e/results-wait-for-the-allocation.spec.ts` pin it; a seed that publishes a `form` market publishes its results first ([the E2E seeds](../../implementation/testing/e2e-seeds.md#reaching-a-stored-assignment)).
- Publishing is recorded in [the market's history](../../implementation/data/history.md) (`publish-results`), with who published.

## Superseded

- Publish Results as a secondary action on Applications from the first verdict on, never named by the rail (wayfinding/what-to-show-and-when/02); it waits for a current run in Assignment, and the rail leads there when it is what holds the market back (wayfinding/rejection-visibility/02, E36/F04).
