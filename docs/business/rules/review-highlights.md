---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#save_review_highlights
  - back-end/app.py#save_review_highlights
  - front-end/src/utils/reviewHighlights.ts
  - front-end/src/utils/reviewQueue.ts#reviewAnswers
  - front-end/src/components/application/ReviewHighlights.vue
verified: 2026-11-05
sources:
  - wayfinding/the-order-of-the-work/05
  - E19/F03/S01
  - E19/F03/S02
  - E19
  - E38/F03/S01
  - T206
---

# Review highlights

A market marks the answers a reviewer reads first, and the review card leads with them; every other answer folds away behind a disclosure.
A market that has marked nothing shows every answer, as if highlights did not exist.

**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md).

## Why

**They live on the market, never on the form.**
The form locks at the first application, and an organizer learns which answers they need by reading real ones, so a mark on a form field would freeze at exactly the moment it becomes knowable ([the form locks at the first application](the-form-locks-at-the-first-application.md)).
So the highlights take no part in the form's lock: they change in every phase the market can still change.
Off the form they can also mark an essential answer, which is no form field at all, so one list of answer keys marks both kinds alike.
An absent list and an empty one both mean nothing is marked, so no stored market needed a migration.

**Choosing that nothing leads is a decision of its own** (T206).
Since neither an absent list nor an empty one says anyone chose it, the market keeps `nothingLeadsTheCard` beside the list: true only while nothing is marked, and set false by any write that does not ask for it, so marking an answer replaces it.
A draft does not enter Review until one or the other is decided, a live mark or "Nothing leads the card" ([review waits on the review setup](review-waits-on-the-review-setup.md)), so leaving the list empty is no longer how a draft says "every answer": Review setup says the section is not decided and offers "Nothing leads the card" as one click, and the control's help line no longer calls an empty list fine.
The review queue's "Choose what leads the card" offers no such choice: the decision belongs to a draft.

**Authored where the questions are written, corrected where the knowing happens.**
The organizer marks them on the form tab's Review setup, and a reviewer changes them from the review card mid-queue ("Choose what leads the card") without leaving the card they are on.
Both are one list with one writer, so neither screen holds its own idea of what leads.

**A flag, not a rank.**
Most markets want two or three answers on top and draw no finer line; the card leads with them in the order they were marked, and there is nothing else to arrange.

**The disclosure has a cost, and the card pays it.**
At card forty a click to reach an unmarked answer is a tax, so the disclosure names how many answers it hides ("7 more answers") and stays open across cards once a reviewer opens it.

**Three notions of "matters" stay apart**: a required answer is one the applicant cannot submit without, a solver-relevant answer one whose change reopens a review, and a highlight one a reviewer reads first; the [glossary](../../../CONTEXT.md#applying) keeps them independent.
The highlights replaced a heuristic that put the organizer's own questions before the essential answers, which was wrong both ways: a "how did you hear about us?" is noise on a triage card, and an availability answer can be the whole decision.

## Who may

An Editor or above changes them; nobody changes an archived market's ([what each role may do](what-each-role-may-do.md), [an archived market is read-only](an-archived-market-is-read-only.md)).

## Where it is kept

- `reviewHighlights` is a list of answer keys on the market document, beside `applicationForm` and not inside it ([the market document](../../implementation/data/market-document.md#the-fields-that-matter)).
- `PUT /markets/:id/review-highlights` (`save_review_highlights` in [`back-end/app.py`](../../../back-end/app.py) and [`back-end/api/markets.py`](../../../back-end/api/markets.py)) is its one writer, loading the market through the change loader on the table's form row, EDITOR by default, with no form lock; it drops repeats and blanks and keeps the order ([each write names what it changes](../../adr/0008-each-write-names-what-it-changes.md)).
- The same write is the one writer of `nothingLeadsTheCard`: `{keys: [], nothingLeadsTheCard: true}` decides that nothing leads, a flag that is not a JSON boolean is refused, and so is the flag beside a marked answer, in the organizer's words; it answers `{reviewHighlights, nothingLeadsTheCard}` as stored, and the market read serves the flag, false when absent.
- [`front-end/src/utils/reviewHighlights.ts`](../../../front-end/src/utils/reviewHighlights.ts) is the one list both screens change, and [`ReviewHighlights.vue`](../../../front-end/src/components/application/ReviewHighlights.vue) the control on both, which also offers a mark the current offering no longer asks, so it can always be taken off.
- `reviewAnswers` in [`front-end/src/utils/reviewQueue.ts`](../../../front-end/src/utils/reviewQueue.ts) splits a card into the marked answers, in their order, and the rest, in the card's own order; the review card, the All view and the import preview's rows read it, the card and the preview through one layout of the answers (`ApplicationAnswers.vue`).
- `back-end/tests/test_review_highlights.py`, `front-end/src/__tests__/reviewQueue.test.ts` and `front-end/e2e/review-highlights.spec.ts` pin it, and `back-end/tests/test_the_review_setup_decisions.py` its "none"; the composable's `chooseNone` writes it, through `useSavedOnTheMarket` (`front-end/src/utils/savedOnTheMarket.ts`), which holds a list's "none" beside it.
- The screens are [what a reviewer reads first](../flows/form-tab.md#f3-what-a-reviewer-reads-first) and [choose what leads the card](../flows/review.md#i3-choose-what-leads-the-card).
- Each change of the highlights is recorded in [the market's history](../../implementation/data/history.md) (`review_highlights`), as they were and as they are, with `nothing_leads_the_card` when it changed; the history says "decided nothing leads the card" when it turned true, and "changed the review highlights" otherwise.
