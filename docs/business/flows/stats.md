---
layer: business
kind: flow
describes:
  - front-end/src/views/StatsView.vue
  - front-end/src/utils/applicantStats.ts
  - front-end/src/utils/answerCounts.ts
  - back-end/answer_counts.py
verified: 2026-10-29
sources:
  - E45/F01/S01
  - E45/F01/S02
---

# The market's statistics

**Who:** anyone who can read the market, a Viewer included; the page changes nothing ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Stats tab, last on the market bar, at `/markets/<id>/stats`, open in every phase from draft to the archive.

The Stats page ([`StatsView.vue`](../../../front-end/src/views/StatsView.vue)) reads the market's figures as cards of bars: each row an answer with its count, its share of the whole and a bar against the largest in its card, rather than a chart library.
Before anyone applies it says "Nobody has applied yet." and nothing else.

## N1. See who applied

**Status:** Works (read from the code as of E45/F01/S01: `the-stats-tab.spec.ts`).

1. "Who applied" totals the market's [applications](../concepts/application.md), counted in the browser from the list the Applications tab reads ([`applicantStats.ts`](../../../front-end/src/utils/applicantStats.ts)): "7 applications in all, 1 of them added by hand".
2. "By status" counts them as the Applications tab's All view filters them: To review, Needs follow-up, Approved and Rejected, each count what that filter lists; a row opens the All view on its filter.
3. "Applied per day" counts those who applied by the day they did, earliest first, in the reader's own calendar; a vendor added by hand never applied, so is on no day.

Covered by: `the-stats-tab.spec.ts` ("the Stats tab counts who applied as the Applications tab does").

## N2. See what they answered

**Status:** Works (read from the code as of E45/F01/S02: `the-stats-tab.spec.ts`, `test_a_chart_per_choice_question.py`).

1. "What they answered" shows a card per question of the form that offers choices (select, multi-select or checkbox), titled by the question, in the form's order; a free-text question, and the essential questions about dates, tiers and tables, are not charted.
2. Each option the question offers is a row, one nobody chose included, at zero; a multi-select counts every option ticked, so its shares add up to more than 100%; a checkbox reads "Yes" and "No".
3. Every answer the question does not offer, written in under "Other" on a Google Form or an option since taken off, is one row, "Other", counting each applicant once however many they wrote; those who gave no answer are a row, "No answer". Either is left out when nobody is in it.
4. A switch, "All applicants", "Approved" and "Placed", narrows every card at once, with "N of M" beside it; the choice is kept in the address (`?among=approved`, `?among=placed`), so a reload or a shared link opens on it.
   Approved is the All view's Approved, those added by hand among them; Placed is everyone the stored assignment gives a table on any date, whatever their verdict, as the outcome they are told is read.
   A share is of the group chosen.
5. A group nobody is in says so instead of charting noughts: "Nobody is approved yet.", "Nobody has a table yet."
   A form with no question to chart says "The form asks no question with choices to count."

A row leads nowhere: the All view filters by status, not by an answer.
The counts are made on the server (`GET /markets/<id>/answer-counts`, [`back-end/answer_counts.py`](../../../back-end/answer_counts.py), read by [`answerCounts.ts`](../../../front-end/src/utils/answerCounts.ts)), so the page reads one small answer however many applied; they read the answers as stored.
Covered by: `the-stats-tab.spec.ts` ("a chart per choice question counts each option, groups "Other", and narrows to the approved and the placed"), `test_a_chart_per_choice_question.py`.

## The rules it obeys

- [What each role may do](../rules/what-each-role-may-do.md): reading the market is all the page asks.
