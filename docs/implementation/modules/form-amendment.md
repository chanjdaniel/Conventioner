---
layer: implementation
kind: module
describes:
  - back-end/api/form_amendment.py
  - back-end/app.py#application_form_amendment_availability
  - back-end/app.py#amend_application_form
  - back-end/app.py#resume_application_form_amendment
  - front-end/src/components/application/AmendFormDialog.vue
verified: 2026-10-27
sources:
  - wayfinding/the-order-of-the-work/07
  - wayfinding/the-order-of-the-work/map
  - wayfinding/claims-and-room/map
  - wayfinding/claims-and-room/03
  - E20/F03
  - E20/F03/S01
  - E20
---

# The form amendment

[`back-end/api/form_amendment.py`](../../../back-end/api/form_amendment.py) fixes the application form from inside the import (E20/F03).
When the column mapping shows the form asked the wrong thing, the organizer used to follow four printed instructions across two phase moves, losing their upload on the way; the amendment walks the market back to `draft`, writes the form there, and walks it back to the phase it started in, in one request.

## Its interface

| Endpoint | What it does |
| --- | --- |
| `GET /markets/:id/application-form/amendment` | whether the form can be amended from here, how many hops it takes and where it returns, or why not; [`AmendFormDialog.vue`](../../../front-end/src/components/application/AmendFormDialog.vue) reads it to open, so it refuses with a reason rather than by failing |
| `POST /markets/:id/application-form/amendment` | the form, written and the market returned: 409 with the blockers when pre-flight refuses, 409 with where it stopped when it stalls |
| `POST /markets/:id/application-form/amendment/resume` | finishes a stalled walk from wherever the market now is |

All three are in [`back-end/app.py`](../../../back-end/app.py) and ask ADMIN.

## Sharp edges

**It adds no transition edge.**
The form is writable only in `draft`, and the way back from `applications_closed` is through `applications_open`, because the transition table lets only the open phase return to draft.
So the route is a breadth-first walk of `VALID_TRANSITIONS` (`route_between` in [the guards](guards.md)): two hops from `applications_open`, four from `applications_closed`, and the market returns to the phase it started in.
An edge added or removed in `guards.py` changes the walk with no edit here.
It is offered only from those two phases, the only two an import runs in, and only while nobody has applied: after the first application the form is frozen for good and the way back to draft is closed.

**Pre-flight, not rollback.**
Every guard on every hop is judged against the PROPOSED form before the market moves (`judge_route` over a copy of the market carrying it).
Judging the stored form would pass a market whose current form is fine, move it to draft, write a form that asks nothing and then refuse the return, stranding it mid-import.
There is nothing to roll back, because nothing moved.

**A stalled walk says where it stopped.**
Pre-flight cannot prevent a transport failure or a concurrent move between two hops, so `Market.form_amendment` records the destination (`returnPhase`, `startedAt`) before the first step and is cleared after the last.
A hop that finds the market moved stops with `AmendmentStalled`, naming the phase it is in and the steps left; resume re-plans from the market's current phase rather than replaying the old walk.

**The form is still written by `save_application_form` in `draft`**, the ordinary writer meeting the ordinary lock, so the D9 lock stays unbypassable ([the form locks at the first application](../../business/rules/the-form-locks-at-the-first-application.md)).

**The chain is ADMIN, because it moves phases**: an amendment an EDITOR could run would walk a market through draft below the phase move's own bar ([what each role may do](../../business/rules/what-each-role-may-do.md)).
It loads through `_load_market_to_change`, so an archived market is refused.

**Each hop is a real phase move**, written through `apply_phase_transition` under the organizer who ran it, so the [phase record](phase-record.md) holds every hop; it is the one mover besides `take_move` ([the guards](guards.md)).

**An amendment re-dates the form.**
Entering `draft` clears the form's `publishedAt` and leaving it stamps it again, so after an amendment the stamp is the amendment's moment: right, since the form did change, and visible in the record though not in the organizer's work.
The dialog says so before it runs, and that the market's public application page is down for the walk; only the Google Form path imports, so on today's screens that page is a gated market's, which answers as absent anyway.

**It answers both of the import's dead ends**: a column with nowhere to go, which adds a question for it, and a preference the Google Form never asked, which switches that question off.
Its refusals keep the import's own voice, saying what is wrong and what would fix it, the advisory the dead end used to carry.

## Why

- [The form locks at the first application](../../business/rules/the-form-locks-at-the-first-application.md): a form found wrong after leaving draft, while nobody has applied, is fixed here, through the lock rather than around it.
- [What an import may leave unasked](../../business/rules/what-an-import-may-leave-unasked.md): switching off a ranking the Google Form never asked runs the same chain.

`back-end/tests/test_form_amendment.py` and `front-end/e2e/form-amendment.spec.ts` pin it.

What the organizer does instead, when they leave the import to fix the form, is [Reopen for Editing](../../business/flows/form-tab.md#f5-reopen-the-market-to-fix-the-form).
The fix from inside the import, as the organizer meets it, is [H2e to H2g](../../business/flows/import.md#h2e-add-a-question-for-a-column-with-nowhere-to-go).

The glossary concept it serves: [Phase](../../business/concepts/phase.md).
