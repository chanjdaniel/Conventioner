---
layer: business
kind: flow
describes:
  - front-end/src/views/StatsView.vue
  - front-end/src/utils/applicantStats.ts
  - front-end/src/utils/answerCounts.ts
  - front-end/src/utils/marketStats.ts
  - back-end/market_stats.py
verified: 2026-10-29
sources:
  - E45/F01/S01
  - E45/F01/S02
  - E41/F01/S01
---

# The market's statistics

**Who:** anyone who can read the market, a Viewer included; the page changes nothing ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Stats tab, last on the market bar, at `/markets/<id>/stats`, open in every phase from draft to the archive.

The Stats page ([`StatsView.vue`](../../../front-end/src/views/StatsView.vue)) reads the market's figures as cards of bars: each row an answer with its count, its share of the whole and a bar against the largest in its card, rather than a chart library.
Before anyone applies it says "Nobody has applied yet." and nothing else.
Both sections are counted on the server and read in one small answer (`GET /markets/<id>/stats`, [`back-end/market_stats.py`](../../../back-end/market_stats.py), read by [`marketStats.ts`](../../../front-end/src/utils/marketStats.ts)), so the page never downloads the applications to count them, however many applied.

## N1. See who applied

**Status:** Works (read from the code as of E45/F01/S01: `the-stats-tab.spec.ts`).

1. "Who applied" totals the market's [applications](../concepts/application.md): "7 applications in all, 1 of them added by hand".
2. "By status" counts them as the Applications tab's All view filters them: Open, Needs follow-up, Approved and Rejected, each count what that filter lists; a row opens the All view on its filter.
   The server counts every application by its stored status, and the page counts those into the filters through the All view's own test ([`applicantStats.ts`](../../../front-end/src/utils/applicantStats.ts)), so the two pages agree.
3. "Applied per day" counts those who applied by the day they did, earliest first, in the reader's own calendar; a vendor added by hand never applied, so is on no day.
   The server keeps no time zone for a market, so it sends only the time each applied, never who, and the page makes the days.

Covered by: `the-stats-tab.spec.ts` ("the Stats tab counts who applied as the Applications tab does").

## N2. See what they answered

**Status:** Works (read from the code as of E45/F01/S02: `the-stats-tab.spec.ts`, `test_the_stats_tab.py`).

1. "What they answered" shows a card per question of the form that offers choices (select, multi-select or checkbox), titled by the question, in the form's order; a free-text question, and the essential questions about dates, tiers and tables, are not charted.
2. Each option the question offers is a row, one nobody chose included, at zero; a multi-select counts every option ticked, so its shares add up to more than 100%; a checkbox reads "Yes" and "No".
3. Every answer the question does not offer, written in under "Other" on a Google Form or an option since taken off, is one row, "Other", counting each applicant once however many they wrote; those who gave no answer are a row, "No answer". Either is left out when nobody is in it.
4. A switch, "All", "Approved" and "Assigned", narrows every card at once, with "N of M" beside it; the choice is kept in the address (`?among=approved`, `?among=assigned`), so a reload or a shared link opens on it.
   Approved is the All view's Approved, those added by hand among them; Assigned is everyone with an assignment, a table on any date, whatever their verdict, as the outcome they are told is read.
   A share is of the group chosen.
5. A group nobody is in says so instead of charting noughts: "Nobody is approved yet.", "Nobody is assigned yet."
   A form with no question to chart says "The form asks no question with choices to count."

A row leads nowhere: the All view filters by status, not by an answer.
The counts come in the page's one answer, read by [`answerCounts.ts`](../../../front-end/src/utils/answerCounts.ts); they read the answers as the organizer does, an organizer's [update of an answer](../rules/an-update-is-kept-beside-the-vendors-answer.md) counted in its place.
Covered by: `the-stats-tab.spec.ts` ("a chart per choice question counts each option, groups "Other", and narrows to the approved and the assigned"), `test_the_stats_tab.py`.

## The rules it obeys

- [What each role may do](../rules/what-each-role-may-do.md): reading the market is all the page asks.
