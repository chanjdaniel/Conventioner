---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#archived_refusal
  - back-end/api/markets.py#MarketArchivedError
  - back-end/api/markets.py#_load_market_to_change
  - back-end/tests/test_an_archive_is_read_only.py
verified: 2026-10-30
sources:
  - E26/F06/S01
  - bug/30
  - T15
  - E39/F01/S03
  - E40/F01/S03
---

# An archived market is read-only

Nothing in an archived market can be changed, by anyone, whatever their role: its plan, form, applications' verdicts, seats, highlights, rules and phase are the record of what happened.
Who may see the record, and whether to keep it, are still decided: roles change and the market may be deleted.

**Serves:** [The door on market day](../intents/the-door-on-market-day.md).

## Why

An archived market is finished ([ADR 0005](../../adr/0005-phase-is-the-only-lifecycle-state.md)), and one that ran keeps its check-in page as the record of its market days.
A change after the fact would make that record say something that never happened.
Roles and deletion are decisions about the record, not changes to it.

## Who may

Nobody changes it; an owner or admin still manages its roles, and its owner may delete it.
Anyone the table lets read it or its history still does ([reading the market's history](../flows/reading-the-markets-history.md)): an archived market still takes the reading rows, and reading changes nothing.
Its table of who may do what is part of the record too, and its owner no longer changes it (E39/F01/S03).

## Where it is kept

- **A market write loads through `_load_market_to_change()`** in [`back-end/api/markets.py`](../../../back-end/api/markets.py), which refuses an archived market with `MarketArchivedError`.
  It is a `ForbiddenError` ([an exception never reaches a client](../../implementation/conventions/an-exception-never-reaches-a-client.md)), so it answers a 403 carrying its words wherever it is raised; a refusal that needed a new branch per route would be one forgotten branch from a 500.
  A new write loads through it, never through `_load_market_for`, so it cannot forget the rule.
  The loader asks the write's row of the table first ([the market's actions](../../implementation/modules/market-actions.md)), and this rule refuses whoever that row lets through.
- A route that loads its own market asks `archived_refusal()`: the floorplan save and every floorplan action but the export ([floorplan placement](../../implementation/modules/floorplan-placement.md#who-may-use-the-floorplan-routes)), publishing results, the import and the CSV start (`_importing_market_document` in `back-end/app.py`), and every review write through `verdict_refusal`.
  The phase cannot move either: no edge leaves `archived` ([the guards](../../implementation/modules/guards.md)).
- The locks the market read serves give the archived reason first where it applies (`readOnlyReason`, `actionRefusals`, the form's, the assignment rules', the automatic rejections'), since it is the true one; the setup's says only that it settled on leaving draft.
  The phase itself is on [the market document](../../implementation/data/market-document.md).
- On screen the phase rail alone says the market is archived; [the market frame](../../implementation/modules/market-frame.md) shows no read-only note beside it (T15).
- [`back-end/tests/test_an_archive_is_read_only.py`](../../../back-end/tests/test_an_archive_is_read_only.py) runs the writes that load through the change loader (rename, plan, highlights, form, the form amendment, the run, a seat, a freed seat, a swap) against an archived market and checks nothing is written, and that the refusal is a `ForbiddenError`, 403; and sends one write of every row of [the table](../../implementation/modules/market-actions.md) through its route, each refused in this rule's words exactly when the row is not one an archived market still takes (`ARCHIVED_STILL_TAKES`), the phase move refused by the transition table since no move leaves `archived`.
