---
layer: business
kind: rule
describes:
  - back-end/guards.py#ReviewHighlightsDecidedGuard
  - back-end/review_highlights.py
  - front-end/src/components/application/ReviewSetupDecision.vue
verified: 2026-11-03
sources:
  - T206
  - T191
---

# Review waits on the review setup

A draft does not enter Review until its organizer has decided what a reviewer reads first: marked at least one answer that leads the card, or chosen "Nothing leads the card".
Until then the move out of draft is refused, "Decide what reviewers read first" leads to Review setup, and a Google Form market's first import is refused with the same words.

**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md) and [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

## Why

Review setup is the Application Form tab's last step, and nothing on the way to Review mentioned it, so a market reached Review with every answer on the card in the form's order because nobody asked, not because the organizer chose it.
Daniel met it on a QC walk (T191, its finding F15), and chose that Review is refused until it is decided, with "none" an explicit choice of one click.

**"None" is a decision, not an empty list.**
An absent list and an empty one both mean nothing is marked, so neither says anyone decided; the market keeps `nothingLeadsTheCard` beside the list, set by its own write ([review highlights](review-highlights.md)).
A mark counts only while it names an answer the market asks, a question of the form or an essential question the plan asks, since a mark on a question that has since gone would lead the card with nothing.

**Only the move out of draft asks.**
The guard sits on `draft -> applications` alone, never as an entry invariant of Review, so a market that left draft before the rule existed is refused none of its moves for it, and is never told the decision is open.
A market that goes back to draft is a draft again, and is asked like any other.

## Who may

The decision is the form's row of the market's actions, an Editor's or above ([what each role may do](what-each-role-may-do.md)).
Someone the table refuses it reads the rail's sentence and Review setup's notice, and is offered neither the rail's link nor the "none" button.

## Where it is kept

- `ReviewHighlightsDecidedGuard` (`review_highlights_decided`) in [`back-end/guards.py`](../../../back-end/guards.py), on `draft -> applications` after `form_has_fields` and before `responses_imported`, its fix `form?step=review` on the `change-form` row ([the guards](../../implementation/modules/guards.md)).
- `highlights_decided` and `live_highlights` in [`back-end/review_highlights.py`](../../../back-end/review_highlights.py) are the one statement of decided, which the guard reads; `liveHighlights` in `front-end/src/utils/reviewHighlights.ts` mirrors `live_highlights` for the screen.
- A Google Form market's first import judges the move before it reads a row (`first_import_blockers`, [review needs an import](review-needs-an-import.md)), so it is refused with the guard's message while the decision is open.
- On Review setup, [`ReviewSetupDecision.vue`](../../../front-end/src/components/application/ReviewSetupDecision.vue) draws the notice, the "none" button and its read-back, shown from the served `transitionBlockers.applications` ([what a reviewer reads first](../flows/form-tab.md#f3-what-a-reviewer-reads-first)).
- `back-end/tests/test_guards.py` (`TestReviewHighlightsDecidedGuard`), `back-end/tests/test_csv_import.py`, `front-end/src/__tests__/reviewSetupDecidesWhatLeadsTheCard.test.ts` and `front-end/e2e/review-highlights.spec.ts` ("A draft decides what a reviewer reads first") pin it.
- Every seed that takes a draft into Review decides first, through `decideReviewSetup` in the E2E helpers and `REVIEW_SETUP_DECIDED` in `back-end/tests/conftest.py`; a spec that walks a draft into Review through the screens decides on Review setup (`MarketSetupPage.decideOnReviewSetup`).
