---
id: E03
title: MVP market lifecycle
type: epic
status: done
blocked_by: []
pr: [#65]
---

## Outcome

A CSV-intake market walks the existing phase machine from `draft` to `assignment` without hitting a guard that was written for a different intake, and without exposing an applicant-facing surface that MVP does not support.

## Why now

Two structural blockers sit on the MVP path, both found while charting:

- `FormHasFieldsGuard` requires at least one *custom* field, but the five essential questions deliberately live outside `applicationForm.fields`. A market whose form is exactly those questions cannot leave `draft`.
- The public applicant routes answer for any market, but MVP has no offers, no outcome emails, and a stub `MarketHomeView`. A stranger could apply and never hear anything.

Neither is large. Both are on the critical path, and the first is a pre-existing bug rather than new work.

## Decisions

All settled.
[06: Intake mode on Market](../../wayfinding/v0-1-0/issues/06-intake-mode-semantics.md) owns the applicant-surface half: the values, what is and is not gated (never check-in, never the form builder), the single new lookup helper beside `published_market_by_slug`, freezing after `draft`, and the fail-closed default.
[07: What does the public slug route render?](../../wayfinding/v0-1-0/issues/07-public-slug-route-disposition.md) finished that half: a gated market answers as a nonexistent one does, and designing a public market landing page is out of scope.

The guard correction needed no decision and is specified in `F01/S01`.
