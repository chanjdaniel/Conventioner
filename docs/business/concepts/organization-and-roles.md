---
layer: business
kind: concept
verified: 2026-10-22
---

# Organization and roles

**Organization** and **Organizer** are defined in [the glossary](../../../CONTEXT.md#organizing), under Organizing; this node gathers what the graph says about an organization, its people, and the roles they hold on a market.

## Rules

- [What each role may do](../rules/what-each-role-may-do.md): Viewer reads, Editor works on the market, Admin moves and publishes.
- [When an organization may be deleted](../rules/when-an-organization-may-be-deleted.md): its drafts and archived markets go with it, refused while one is mid-lifecycle.
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md): roles on an archived market still change, since they are not the record.

## Flows

- [Accounts](../flows/accounts.md): an organizer registers, signs in and deletes their account.
- [Organizations](../flows/organizations.md): creating one, its people, renaming, deleting and transferring it.
- [Choose among several organizations](../flows/creating-a-market.md#d3-choose-among-several-organizations) and [create a market with no organization yet](../flows/creating-a-market.md#d4-create-a-market-with-no-organization-yet): every market belongs to one.
- [The markets list](../flows/finding-a-market.md#c2-the-markets-list): narrowed by organization.
- [Manage who has access](../flows/ending-and-managing-a-market.md#l3-manage-who-has-access): a market's roles.

## Implementation

- [The organization document, and roles](../../implementation/data/organization-document.md): organizations, a market's roles map, and what membership gives.
- [Users, and the one spelling of an address](../../implementation/data/users-and-email.md): organizer accounts.
- [Lookup indexes](../../implementation/data/lookup-indexes.md): the organization indexes and the wildcard over a market's roles.
- [Market deletion, and the deletion trail](../../implementation/modules/market-deletion.md): an organization's deletion recorded before anything is destroyed.
