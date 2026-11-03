---
layer: business
kind: rule
describes:
  - back-end/api/applicants.py#publish_results_refusal
  - back-end/api/applicants.py#publish_results
  - back-end/result_outcome.py
  - back-end/guards.py#ResultsPublishedGuard
  - back-end/app.py#publish_market_results
verified: 2026-11-04
sources:
  - wayfinding/readable-journey/01
  - wayfinding/rejection-visibility/02
  - wayfinding/rejection-visibility/map
  - wayfinding/what-to-show-and-when/02
  - E36/F04
  - E36/F04/S01
  - E36/F04/S02
  - E38/F05
  - T202
---

# Publish results waits for the allocation

A market publishes its results in `assignment`, once an assignment is stored and current, and only then; publishing settles that assignment, and the market goes live only after it.
The rule is the same on both paths ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)): a market that imports its vendors tells them on its vendor page, which opens with its results ([a gated market answers as absent](a-gated-market-answers-as-absent.md)).
No email goes out on either: the confirmation says so, and gives the page's address to share.

**Serves:** [Results go out once, and settle the allocation](../intents/results-go-out-once-and-settle-the-allocation.md).

## Why

Results tell each applicant whether they have a table, so they can be told only once the seats exist; and once told, nobody's answer may shift under them through a later run.
Before E36 results could be published on a market with nothing reviewed and nothing assigned, and a market could go live with its applicants still reading "Submitted".
Publishing results stays its own act, never part of going live; the decision and what it costs are [ADR 0013](../../adr/0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md).

**Publishing settles the allocation.**
After it the run is refused (`assign_refusal`, served as `assignRefusalReason`) and [the assignment rules](the-assignment-rules-close-with-the-assignment.md) lock; a single seat is still changed by hand on the Assignments page.
There is no unpublish: nothing writes `resultsPublished` back to false.

**The market does not go live first.**
`ResultsPublishedGuard` is an entry invariant on `market_days`, so no market can publish its check-in page until its vendors have been told: "Vendors have not been told whether they have a table. Publish the results before the market goes live.", with "Publish results".
A CSV market already in its market days before this rule reached it stays there; its vendor page is open from them ([a gated market answers as absent](a-gated-market-answers-as-absent.md)).

**The outcome is read off the stored seats, never the verdict.**
An applicant seated on any date has a table; everyone else (rejected, or approved and not placed) reads "You did not get assigned", with no reason (`back-end/result_outcome.py`).
The publish confirmation counts both by that same rule (`publishOutcomes`), counting main applications only: 'N vendors will read "You have a table". M will read "You did not get assigned".'.

## Who may

An ADMIN or the owner, as with every action that tells people outside the market; never on an archived market.

## Where it is kept

- `publish_results_refusal` in [`back-end/api/applicants.py`](../../../back-end/api/applicants.py) says the rule, on either path: refused once already published, outside `assignment`, with nothing stored, or with the stored run [out of date](an-assignment-knows-when-it-is-out-of-date.md).
  `publish_results` asks it and sets `resultsPublished` on [the market document](../../implementation/data/market-document.md#the-fields-that-matter); `POST /markets/:id/publish-results` ([`publish_market_results`](../../../back-end/app.py)) asks the table's Publish results row ([the market's actions](../../implementation/modules/market-actions.md)), ADMIN by default, and the archived rule first.
- The market read serves who may, the table's Publish results answer in `actionRefusals`, and this rule apart, as `publishWaitsReason`, and the counts as `publishOutcomes` only while neither refuses.
  The Applications page ([`PublishResults.vue`](../../../front-end/src/components/application/PublishResults.vue)) draws the button on both paths, from `assignment` on only, for whoever may publish, and disables it with the rule's words while it refuses, so it is offered exactly when the endpoint would take it.
- [`back-end/result_outcome.py`](../../../back-end/result_outcome.py) is the one reading of who has a table, for the confirmation and for the applicant's page.
- `ResultsPublishedGuard` in [`back-end/guards.py`](../../../back-end/guards.py), kept by [the guards](../../implementation/modules/guards.md); whether the run is current is [what it was made from](../../implementation/modules/made-from.md).
- `back-end/tests/test_publishing_settles_the_assignment.py`, `back-end/tests/test_results_wait_for_the_allocation.py`, `front-end/e2e/results-wait-for-the-allocation.spec.ts` and, for a CSV market, `front-end/e2e/a-google-form-markets-vendor-page.spec.ts` pin it; a seed that publishes a market publishes its results first ([the E2E seeds](../../implementation/testing/e2e-seeds.md#reaching-a-stored-assignment)).
- Publishing is recorded in [the market's history](../../implementation/data/history.md) (`publish-results`), with who published.

## Superseded

- A market that imports its vendors had no applicants to tell, so it had neither the publish nor the wait (ADR 0013); its vendors read their table on its vendor page, so it publishes and Publish market waits for it ([ADR 0022](../../adr/0022-the-vendor-page-is-signed-in.md)).

- Publish results as a secondary action on Applications from the first verdict on, never named by the rail (wayfinding/what-to-show-and-when/02); it waits for a current run in Assignment, and the rail leads there when it is what holds the market back (wayfinding/rejection-visibility/02, E36/F04).
- Drawn disabled, with its reason, over the review in the phases before Assignment; on the 2026-10-29 walk Daniel chose to show it only from Assignment on (E38/F05).
