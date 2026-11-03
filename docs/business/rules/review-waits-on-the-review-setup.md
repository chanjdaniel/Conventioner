---
layer: business
kind: rule
describes:
  - back-end/guards.py#ReviewHighlightsDecidedGuard
  - back-end/guards.py#RejectionRulesDecidedGuard
  - back-end/review_highlights.py
  - back-end/rejection_rules.py#Rulebook
  - front-end/src/components/application/ReviewSetupDecision.vue
verified: 2026-11-03
sources:
  - T206
  - T191
---

# Review waits on the review setup

A draft does not enter Review until its organizer has taken Review setup's two decisions:
- what a reviewer reads first: marked at least one answer that leads the card, or chosen "Nothing leads the card";
- the automatic rejections: added a rule that rejects at least one answer, or chosen "No automatic rejections".

Until both are taken the move out of draft is refused, "Decide what reviewers read first" and "Decide the automatic rejections" lead to Review setup, and a Google Form market's first import is refused too, saying the first open decision once nothing earlier in the move's order refuses it.

**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md) and [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

## Why

Review setup is the Application Form tab's last step, and nothing on the way to Review mentioned it, so a market reached Review with every answer on the card in the form's order and no rule rejecting anyone because nobody asked, not because the organizer chose it.
Daniel met it on a QC walk (T191, its finding F15), and chose that Review is refused until both are decided, with each "none" an explicit choice of one click.

**"None" is a decision, not an empty list.**
An absent list and an empty one both mean nothing is marked, so neither says anyone decided; the market keeps `nothingLeadsTheCard` beside the highlights and `noAutomaticRejections` beside the rules, each set by its list's own write ([review highlights](review-highlights.md), [automatic rejections](automatic-rejections.md)).
A mark counts only while it names an answer the market asks, a question of the form or an essential question the plan asks, since a mark on a question that has since gone would lead the card with nothing.
A rule counts only while it names an answer that rejects, as the rules stand against the current form: a rule with no answer ticked yet rejects nobody, and one on a question the form no longer asks judges nothing.
The "none" button is offered only while nothing decides, so it never discards a live mark or a rule that rejects; choosing "No automatic rejections" beside a rule with no answer ticked clears that rule, which rejected nobody.

**Only the move out of draft asks.**
The two guards sit on `draft -> applications` alone, never as entry invariants of Review, so a market that left draft before the rule existed is refused none of its moves for them, and is never told a decision is open.
A market that goes back to draft is a draft again, and is asked like any other.

## Who may

Both decisions are the form's row of the market's actions, an Editor's or above ([what each role may do](what-each-role-may-do.md)).
Someone the table refuses it reads the rail's sentence and Review setup's notices, and is offered neither the rail's link nor a "none" button.

## Where it is kept

- `ReviewHighlightsDecidedGuard` (`review_highlights_decided`) and `RejectionRulesDecidedGuard` (`rejection_rules_decided`) in [`back-end/guards.py`](../../../back-end/guards.py), in that order on `draft -> applications` after `form_has_fields` and before `responses_imported`, each fixed at `form?step=review` on the `change-form` row ([the guards](../../implementation/modules/guards.md)).
- `highlights_decided` and `live_highlights` in [`back-end/review_highlights.py`](../../../back-end/review_highlights.py), and `Rulebook.decided` in [`back-end/rejection_rules.py`](../../../back-end/rejection_rules.py), are the one statement of each decision, which its guard reads; `liveHighlights` in `front-end/src/utils/reviewHighlights.ts` and `rulesDecide` in `front-end/src/utils/rejectionRules.ts` mirror them for the screen.
- A Google Form market's first import judges the move before it reads a row (`first_import_blockers`, [review needs an import](review-needs-an-import.md)), so it is refused with a guard's message while a decision is open.
- On Review setup, [`ReviewSetupDecision.vue`](../../../front-end/src/components/application/ReviewSetupDecision.vue) draws each section's notice, "none" button and read-back, shown from the served `transitionBlockers.applications` ([what a reviewer reads first](../flows/form-tab.md#f3-what-a-reviewer-reads-first)); once the rules settle at Assignment, "No automatic rejections" is no longer read back, and the section reads as settled rules always have.
- `back-end/tests/test_guards.py` (`TestReviewHighlightsDecidedGuard`, `TestRejectionRulesDecidedGuard`), `back-end/tests/test_csv_import.py`, `front-end/src/__tests__/reviewSetupDecidesWhatLeadsTheCard.test.ts`, `front-end/src/__tests__/reviewSetupDecidesTheAutomaticRejections.test.ts`, `front-end/e2e/review-highlights.spec.ts` ("A draft decides what a reviewer reads first") and `front-end/e2e/automatic-rejections.spec.ts` ("A draft decides the automatic rejections") pin it.
- Every seed that takes a draft into Review decides first, through `decideReviewSetup` in the E2E helpers and `REVIEW_SETUP_DECIDED` in `back-end/tests/conftest.py`; a spec that walks a draft into Review through the screens decides on Review setup (`MarketSetupPage.decideOnReviewSetup`, [E2E patterns](../../implementation/testing/e2e-patterns.md#selectors-and-page-objects)); the journey does it on its way to the import ([the market journey spec](../../implementation/testing/the-market-journey-spec.md)).
