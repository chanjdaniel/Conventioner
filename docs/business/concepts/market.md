---
layer: business
kind: concept
verified: 2026-10-21
---

# Market

**Market** is defined in [the glossary](../../../CONTEXT.md#organizing), under Organizing; this node gathers what the graph says about it.

## Rules

- [The setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md): what a market's plan may still change once it is past draft.
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md): a finished market is the record of what happened.
- [An archived market that ran stays a record](../rules/an-archived-market-that-ran-stays-a-record.md): its check-in page stays up, marked ended.
- [What each role may do](../rules/what-each-role-may-do.md): who reads a market, who works on it, who moves and publishes it.
- [When an organization may be deleted](../rules/when-an-organization-may-be-deleted.md): which of its markets go with it, and which refuse it.

## Flows

- [The market lifecycle at a glance](../flows/lifecycle.md): a market's phases on both paths, and the moves between them.
- [The Google Form path](../flows/the-google-form-path.md), [the online path](../flows/the-online-path.md) and [the mixed path](../flows/the-mixed-path.md): one market from creation to the end, by how its vendors arrive.
- [Creating a market](../flows/creating-a-market.md): the create-market dialog, its organization and its name.
- [Finding and opening markets](../flows/finding-a-market.md): the dashboard, the Markets list and a market's addresses.
- [Planning the market](../flows/planning.md): Market Setup's dates, tiers, locations and sections.
- [Ending and managing a market](../flows/ending-and-managing-a-market.md): archiving, access, renaming and deleting it.

## Implementation

- [The market document](../../implementation/data/market-document.md): how a market is stored, its slug, and the boot refusal.
- [Market deletion, and the deletion trail](../../implementation/modules/market-deletion.md): every record a market keeps goes with it.
- [One market, from the server](../../implementation/conventions/one-market-from-the-server.md) and [the market store](../../implementation/modules/market-store.md): the one copy a screen holds, re-read after every write.
- [Every market page has an address](../../implementation/conventions/every-market-page-has-an-address.md): `/markets/:marketId/...` and the redirects.
- [The market frame](../../implementation/modules/market-frame.md): the bar and tabs every market screen stands in.
- [The market guide](../../implementation/modules/market-guide.md): what each screen says per phase and path.
- [ADR 0008: Each write names what it changes](../../adr/0008-each-write-names-what-it-changes.md): there is no whole-market write.
- [ADR 0009: The back end is the only source of truth about a market](../../adr/0009-the-back-end-is-the-only-source-of-truth.md).
- [The market journey spec](../../implementation/testing/the-market-journey-spec.md): the one spec that walks a market from creation to its result.
