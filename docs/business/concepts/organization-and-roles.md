---
layer: business
kind: concept
verified: 2026-11-11
---

# Organization and roles

**Organization** and **Organizer** are defined in [the glossary](../../../CONTEXT.md#organizing), under Organizing; this node gathers what the graph says about an organization, its people, and the roles they hold on a market.

An organization's people each hold one place in it: its one owner, an admin or a member.
The place is one entry in one map, as a person's role on a market is, so nobody stands in two places, and an organization written before that map is read with the owner winning over any other place they were also listed in ([one map of people](../../implementation/data/organization-document.md#one-map-of-people)).
Adding a person and removing one is each one write that lands only while the places it was judged on still stand, so a change that meets another is refused and said, never half-made ([the organization's people](../../implementation/modules/organization-people.md)).

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
- [The organization's people](../../implementation/modules/organization-people.md): the one writer of an organization's people, what each change may do, and a change that met another.
- [Users, and the one spelling of an address](../../implementation/data/users-and-email.md): organizer accounts.
- [Lookup indexes](../../implementation/data/lookup-indexes.md): the wildcards over an organization's people and a market's roles, and the organization's list indexes.
- [ADR 0025: An organization's people are one map](../../adr/0025-an-organizations-people-are-one-map.md): the map, the fold, and the lists kept beside it for one release.
- [Market deletion, and the deletion trail](../../implementation/modules/market-deletion.md): an organization's deletion recorded before anything is destroyed.
