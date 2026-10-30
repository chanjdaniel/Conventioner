---
layer: business
kind: rule
describes:
  - back-end/rejection_rules.py
  - back-end/api/markets.py#rejection_rules_lock_reason
  - back-end/api/markets.py#save_rejection_rules
  - back-end/api/applications.py#judgeable_applications
  - back-end/api/applications.py#is_judgeable
  - front-end/src/components/application/AutomaticRejections.vue
  - front-end/src/components/application/ChoiceConditions.vue
  - back-end/api/markets.py#may_overturn
verified: 2026-10-30
sources:
  - wayfinding/november-2026-dry-run/map
  - wayfinding/rejection-visibility/map
  - brain-dump/2026-10-19#12
  - brain-dump/2026-10-19#24
  - E33/F03
  - E33/F03/S01
  - E33/F03/S02
  - E41/F01/S01
  - E38/F03/S02
  - E38/F06/S01
---

# Automatic rejections

An organizer may name answers that reject an application: an application that gives one arrives in review already rejected, with the answer as its reason, and an Admin or the owner may overturn it (the table's row "Change a verdict, or overturn an automatic rejection", [what each role may do](what-each-role-may-do.md)).
A rule's rejection is a real one, but it never touches a verdict a person gave, and its reason is the organizer's, never the applicant's.

**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md).

## Why

A real market rejects every applicant who will not agree to its no-show terms, or who is not one of the affiliations it accepts, and each of those was a manual rejection, one card at a time.
A rule does that work and says why on the card, so a reviewer spends their attention where judgement is needed and can still disagree.

**A rule names one choice question and the answers to it that reject.**
The question is one of the organizer's own selects, multi-selects or checkboxes, or an essential choice the market asks: the table choice, or the available dates.
A free-text answer has no fixed set of values, so no rule may name it; the tier preference is a grid of a tier per day, not one choice, so no rule names it either.
A checkbox's answers are "ticked" and "not ticked"; a question has one rule, naming every answer that rejects; a rule with no answer yet is kept and rejects nobody, so the organizer can pick the question first.

**A rule judges only what no person has decided**: the undecided applications, and those a rule rejected.
A person's verdict, an overturned rejection included, is never read, and neither is a follow-up.
An application a rule meets is stored rejected, with the rule as its giver and the answer as its reason ("Answered “Half a table, shared” to “Table choice”", "Did not tick “I understand that no-shows”").
One a rule rejected that no rule meets any longer, because the rule or the answers changed, returns to undecided; once results are published it stands instead, since its applicant has read the outcome.
**Returning it overturns the rejection, so a person's write returns it only when the change row is theirs** (`may_overturn`, E38/F06/S01): someone the change row refuses (an Editor, by default) who narrows or removes a rule, takes a question off the form, updates a vendor's answer or imports leaves what the rules already rejected standing, with its rule and reason, and an Admin or the owner can overturn each one in the review.
An applicant's own save still returns it: they changed the answer the rule read, and nobody overturned a decision.
An applicant can change their answers only while applications are open, so a rejection that changing them undoes never reaches a seat.
An organizer may [update a vendor's answer](an-update-is-kept-beside-the-vendors-answer.md) in any phase, and the rules read the answers as updated, but an update is judged only while the review is open (`review_is_open`, the lock the rules' own save asks): from assignment on the rules have settled, so an update leaves a rule's rejection standing, since an application returned to undecided then is one no verdict could decide.

**A question the application holds no answer to meets no rule**: a checkbox added since it was written, or a column an import left out, is not an unticked box.

**The rules judge when something they read changes**: when the list is saved (every judgeable application of the market), when an applicant saves online (that application), when an organizer updates a vendor's info while the review is open (that application), and at the end of an import (the market, after any approval the import sent back to review), whose result says how many the rules rejected.
Before an import writes anything, its preview judges the file's rows the same way and lists every row they will newly reject, with its reason, so an organizer checks the rules before they reject anyone ([importing a Google Form's responses](../flows/import.md#h2a-first-import-everything-maps)).
Every write is conditioned on the application being as it was read, so a reviewer's verdict that lands in between is never overwritten ([ADR 0014](../../adr/0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md)).

**The reason is the organizer's.**
The review says "Rejected automatically: <reason>", and "Approve instead", offered to whoever the change row lets overturn it, overturns it, the verdict becoming theirs; the applicant reads "Submitted" whatever a rule decided ([an applicant never reads a verdict early](an-applicant-never-reads-a-verdict-early.md)), since a rule judges an application in the request that saves it, and anything more would tell them the moment they submitted.

**The rules are served as they stand against the current form**: a rule on a question the form no longer asks, or an answer it no longer offers, is left out of what the market read serves and of the next save, so a form change never makes the list unsavable.

## Who may

An Editor writes the list (`PUT /markets/:id/rejection-rules`, the whole list at once), while the market can still get back to `applications`, where applications are reviewed; from `assignment` on the rules are shown fixed, settling with the verdicts ([verdicts settle on entering assignment](verdicts-settle-on-entering-assignment.md)), and an archived market refuses anyone.
They are not gated by the form's lock: the form freezes at the first application, and the rules are worth most once applications are arriving.
Overturning what a rule rejected, whether by a verdict or by a save that returns it, is the row "Change a verdict, or overturn an automatic rejection" (default Admin), so an Editor's save changes what the rules reject next, never what they already rejected.
The form tab's line and the import's done line name who may overturn from the market's own table (`whoMayTake` in [`front-end/src/utils/permissionTable.ts`](../../../front-end/src/utils/permissionTable.ts)): "an Admin or the owner" until its owner changes the row.

## Where it is kept

- [`back-end/rejection_rules.py`](../../../back-end/rejection_rules.py) is the one statement of what a rule may say and how it judges: `Rulebook` builds the questions a rule may name and the rules as they stand, `prepared` refuses a write in the organizer's words (a 400 [client error](../../implementation/conventions/an-exception-never-reaches-a-client.md)), `rejecting` finds the first rule an application meets and words its reason, and `judge` applies them, returning a rule's rejection to undecided only when its caller says the writer may overturn one (`overturns`).
- `is_judgeable` in [`back-end/api/applications.py`](../../../back-end/api/applications.py) is which applications a rule may judge, and `judgeable_applications` lists a market's; the giver (`{kind: rule, rule}`) and `verdict_reason` are stored on [the application document](../../implementation/data/application-document.md#statuses), and the reason is served to the organizer as `verdictReason` and never in an applicant's response.
- `save_rejection_rules` and `rejection_rules_lock_reason` in [`back-end/api/markets.py`](../../../back-end/api/markets.py); the lock asks `review_is_open`, as the verdicts do, and the market read serves `rejectionQuestions`, `rejectionRules` and `rejectionRulesLockReason`, so the step offers exactly what the write takes.
- The import judges at its end, and its preview judges without writing ([the CSV import](../../implementation/modules/csv-import.md)).
- Review setup saves them as it saves the highlights, through one composable (`useSavedOnTheMarket`, `front-end/src/utils/savedOnTheMarket.ts`).
- The organizer sets them on the form tab's Review setup ([F3](../flows/form-tab.md#f3-what-a-reviewer-reads-first), [`AutomaticRejections.vue`](../../../front-end/src/components/application/AutomaticRejections.vue)), and reads and overturns them in [the review](../flows/review.md#i2-change-a-decision).
- A rule is drawn by [`ChoiceConditions.vue`](../../../front-end/src/components/application/ChoiceConditions.vue), the one condition builder, which a price group's conditions use too ([a price follows the table](a-price-follows-the-table.md#price-groups)); `Rulebook.met` judges a rule and a group's condition alike, and `Rulebook.broken` says a group's condition names a question or an answer the form no longer has, and the group keeps it, shown broken, where a rule's gone question or answer is simply left out.
- A save that changes the rules is recorded in [the market's history](../../implementation/data/history.md) (`rejection_rules`), counting the applications they rejected and returned; a rule's verdict is never an entry of its own, so the write that judged counts it: the form, an applicant's save, an organizer's update of a vendor's info, an import.

## Evidence

The real November 2026 export is not in the repository, so the import's case is held by `test_an_import_writes_its_rows` and the preview's `TestThePreviewSaysWhoTheyWillReject` (`back-end/tests/test_the_rules_reject.py`) and `front-end/e2e/automatic-rejections.spec.ts` on a rule over the table choice, and the no-show checkbox by `test_an_unticked_agreement`.
