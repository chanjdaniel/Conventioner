---
layer: business
kind: concept
verified: 2026-10-22
---

# Phase

**Phase** is defined in [the glossary](../../../CONTEXT.md#organizing), under Organizing, beside Publish, Market days and Archived; this node gathers what the graph says about it.

## Rules

- [The setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md): what leaving `draft` asks for, and what it fixes.
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md): the form is editable only in `draft`, and only until anyone has applied.
- [A gated market answers as absent](../rules/a-gated-market-answers-as-absent.md): a draft answers applicants as no market at all.
- [Verdicts settle on entering assignment](../rules/verdicts-settle-on-entering-assignment.md): verdicts are open while the market can reach `review`.
- [Assign runs only in assignment](../rules/assign-runs-only-in-assignment.md): the run is refused in every other phase.
- [The assignment rules close with the assignment](../rules/the-assignment-rules-close-with-the-assignment.md): the rules lock once the market can no longer reach `assignment`.
- [Publish Results waits for the allocation](../rules/publish-results-waits-for-the-allocation.md): a form market enters `market_days` only after its results are published.
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md) and [an archived market that ran stays a record](../rules/an-archived-market-that-ran-stays-a-record.md): what `archived` keeps.
- [When an organization may be deleted](../rules/when-an-organization-may-be-deleted.md): refused while any of its markets is mid-lifecycle.

## Flows

- [The market lifecycle at a glance](../flows/lifecycle.md): the phases on both paths, the page each opens on, the moves and what refuses them.
- [Taking applications](../flows/taking-applications.md): opening, closing and reopening applications.
- [Reopen the market to fix the form](../flows/form-tab.md#f5-reopen-the-market-to-fix-the-form): the way back to `draft`.
- [Reviewing applications](../flows/review.md): beginning review, beginning assignment, and returning to Applications Closed.
- [Publish the market](../flows/market-day-door.md#k1-publish-the-market): `assignment` to `market_days`.
- [Ending and managing a market](../flows/ending-and-managing-a-market.md): archiving after market days, or abandoning a market early.

## Implementation

- [The guards and the phase move](../../implementation/modules/guards.md): every precondition on a move, and the one phase writer.
- [The phase rail](../../implementation/modules/phase-rail.md): the lifecycle band an organizer moves the market on.
- [The phase record](../../implementation/modules/phase-record.md): every phase a market entered.
- [The market guide](../../implementation/modules/market-guide.md): what each screen says per phase.
- [The form amendment](../../implementation/modules/form-amendment.md): the one other mover, which walks a market back and forth to fix its form.
- [The market document](../../implementation/data/market-document.md#the-phase-and-isdraft): `phase` stored, and `isDraft` derived from it.
- [ADR 0005: The phase is a market's only lifecycle state](../../adr/0005-phase-is-the-only-lifecycle-state.md).
