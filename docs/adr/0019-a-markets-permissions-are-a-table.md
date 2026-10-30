---
layer: implementation
kind: adr
describes:
  - back-end/api/market_actions.py
  - back-end/api/markets.py#set_permission
  - back-end/api/markets.py#reset_permission
  - back-end/api/markets.py#reset_permissions
  - back-end/datatypes.py#MarketPermission
verified: 2026-10-30
sources:
  - E39
  - E39/F01/S03
  - T92
status: accepted
---

# A market's permissions are a table of actions, each with a minimum role

The module it constrains: [the market's actions](../implementation/modules/market-actions.md); the rule it keeps: [what each role may do](../business/rules/what-each-role-may-do.md).

## Context

Each permission check named its own role, about twenty of them across the routes, so what a role may do was spread over every module that wrote a market and could not be changed anywhere.
Daniel asked for one place (T92): "permissions are getting complicated, so lets centralize and expose these in the market managements. everything that needs permissions should be checked against this and it should be modifiable by the owner only."
E39/F01/S01 gave every check a named action in one table with built-in defaults, the rules each check held before; this decision is what a market keeps of that table, who may change it, and how.

## Decision

**A market's permissions are a table of actions, each with the lowest role that may take it**, that role and every one above it (Owner > Admin > Editor > Viewer).
The table's rows, their labels, groups and built-in defaults, and which rows are fixed are code, in [`back-end/api/market_actions.py`](../../back-end/api/market_actions.py).

**A market stores only the rows it differs on**, in `permissions` on [the market document](../implementation/data/market-document.md): each an action id with the role it asks and where it came from (`MarketPermission` in [`back-end/datatypes.py`](../../back-end/datatypes.py)).
A row the market does not hold reads its built-in default, so an absent field is the built-in table and no market needs a migration; a fixed row is never read from the market, whatever is stored.
Every check asks `minimum_role(row, market)`, the market's row or the default, and the market read serves every row's answer from the same rows.

**Where a row came from is one of three**: the built-in default (no row held), copied from the organization's default when the market was created (E39/F02 writes these), or changed on this market.
An organization's default is a copy, not a live link: a market created from it holds its rows from then on, and a later change to the organization's default reaches only the markets created after it.

**Only the market's owner changes its rows**, through the fixed row "Change this table": one write sets a row's role, another returns it to its built-in default, and another returns every row the market holds at once (`set_permission`, `reset_permission` and `reset_permissions` in [`back-end/api/markets.py`](../../back-end/api/markets.py)).
The owner is the market's single owner; an organization's owner and admins hold Admin on its markets, never Owner, so a market's own rows are not theirs to change (the organization's default is, E39/F02).
An archived market's table is part of its record, and is not changed.

**Every change is recorded** in [the market's history](../implementation/data/history.md) ([ADR 0017](0017-one-history-for-every-change.md)): who, when, the row, and its role and source before and after.

**The rules of a market's life stay outside the table.**
An archived market is read-only, verdicts settle on entering assignment, a vendor is added from the assignment on, and results wait for the allocation, whoever may: each rule is asked where it always was, and the table answers only who may.

## Consequences

- Changing who may take an action on one market is a row on that market, read by the server at the next request and by the screens at the next market read; no code changes.
- A story that gates a new action adds a row with its built-in default, and every existing market reads that default until its owner changes it.
- A row that leaves the table leaves its stored copies behind on markets that hold one; they are never read, because only the table's rows are.
- A market's own rows are its owner's alone, so an organization admin who runs the market cannot loosen or tighten it; that is the point of "modifiable by the owner only".
- The history holds each change with who made it, so "who let Editors move the phase" has an answer.

## Considered and rejected

- **Ticks per role** (a grid of roles by actions, each cell on or off): Daniel chose "who may" per action (T92, Q21: "1 yes. org sets the default. per market can vary. defaults look good."). A grid can say an Editor may and an Admin may not, which no one means and every check would have to allow for; a minimum role keeps the ladder, so a role always may do everything the role below it may.
- **A live link to the organization's default** (a market reads the organization's rows unless it overrides them): Daniel chose a copy (T92, Q22: "1. org admins can 2. copy / every change is logged and recorded. who did what."). With a link, an organization admin's change would alter what people may do on a market that is already running, without its owner's say; a copy changes no market that exists.
- **The rules of a market's life as rows** (an "archived markets may be changed" row, a "verdicts after assignment" row): each is a rule about the market's record or its order, not about who; a row would let an owner rewrite an archived market's record or give verdicts after the review closed, and the guarantees the guards and the review rely on would depend on a setting.
- **Storing every row on every market**: a market would carry the defaults of its creation day for ever, and a corrected default would need a migration of every market; storing only the differences keeps the built-in table one place.
