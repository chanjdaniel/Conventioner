---
layer: implementation
kind: data
describes:
  - back-end/datatypes.py#Organization
  - back-end/datatypes.py#OrganizationRole
  - back-end/datatypes.py#MarketRole
  - back-end/api/organizations.py#create_organization
  - back-end/api/organizations.py#get_organizations_for_user
  - back-end/api/organizations.py#update_organization
  - back-end/api/organizations.py#add_org_admin
  - back-end/api/organizations.py#add_org_member
  - back-end/api/organizations.py#remove_org_user
  - back-end/api/organizations.py#transfer_org_ownership
  - back-end/api/permissions.py
  - back-end/api/markets.py#get_markets_for_user
  - back-end/api/markets.py#create_owned_market
  - back-end/api/markets.py#organization_refusal
  - back-end/api/markets.py#add_market_role
  - back-end/api/markets.py#remove_market_role
  - back-end/api/markets.py#update_market_role
verified: 2026-10-29
sources:
  - E20/F04/S01
  - E21/F03/S01
  - E26/F08/S01
  - bug/46
  - T15
  - T85
  - decision/2026-10-20
---

# The organization document, and roles

One document per organization in the `organizations` collection, and the roles a person holds on an organization and on each market.
[`back-end/api/organizations.py`](../../../back-end/api/organizations.py) writes the organization; [`back-end/api/permissions.py`](../../../back-end/api/permissions.py) resolves what a person may do on a market; the market's own `roles` map is written by `api/markets.py` ([`back-end/api/markets.py`](../../../back-end/api/markets.py)).
The models are `Organization`, `OrganizationRole` and `MarketRole` in [`back-end/datatypes.py`](../../../back-end/datatypes.py).

The glossary concept: [Organization and roles](../../business/concepts/organization-and-roles.md).

## The organization

| Field | What it is |
| --- | --- |
| `id` | a UUID, the primary key; the name is a display field |
| `name` | unique among organizations: creating a second of one name is refused |
| `owner` | the user id of its one owner |
| `admins`, `members` | user ids; the owner is in neither (`validate_owner_not_in_other_roles`); an admin cannot be added as a member, but a member made an admin stays in `members` too |
| `markets` | the ids of its markets, added when a market is created and pulled when one is deleted |
| `theme` | carried, never applied |

Every key is one word, so the spelling question the market document has does not arise.
Membership is recorded on both sides: each user's `organizations` lists the ids of the organizations they are in, kept in step by every membership write ([users and email](users-and-email.md)).
`get_organizations_for_user` finds a person's organizations with an `$or` over `owner`, `admins` and `members`, each a [lookup index](lookup-indexes.md).

**Who changes an organization**: only the owner renames it, adds an admin or transfers ownership; the owner or an admin adds a member; the owner removes anyone but themselves, an admin only members.
Renaming is all an update does: it reads the body's `name`, a string that is not blank, and nothing else, so the owner, the admins, the members and the markets change only through the writes above, which keep each user's `organizations` in step.
Transferring ownership makes the old owner an admin.
The owner cannot be removed, and an account that owns an organization cannot be deleted until it hands it on.
Deleting an organization is the owner's, deletes the drafts and archived markets it holds, and is refused while it holds a market mid-lifecycle ([when an organization may be deleted](../../business/rules/when-an-organization-may-be-deleted.md), through [market deletion](../modules/market-deletion.md)).
What the owner and the admins do with these, screen by screen, is [the organizations flows](../../business/flows/organizations.md).

## Roles on a market

**A market's `roles` is a map from user id to one role**: `owner`, `admin`, `editor` or `viewer`, with exactly one `owner` (`validate_single_owner` on `Market`).
A map, not one list per role, so nobody can hold two roles on one market.
Whoever creates a market owns it, and only they do (`create_owned_market`): the create body's roles were once taken on trust, so a client could make a market owned by someone else or by nobody (bug 46).
Anyone else is added afterwards by email, through `add_market_role`, which stores their user id; they must already have an account.
The owner's entry cannot be changed, removed or added beside, so a market's ownership cannot be handed on.
An owner manages every other role; an admin manages editors and viewers: the table's two rows for roles, Give and take Admin roles (Owner, fixed) and Give and take Editor and Viewer roles (Admin), which `roles_row` picks by the role given or taken ([the market's actions](../modules/market-actions.md)).
Roles change on an archived market too: they are not a change to its record.

**"Markets this person has a role on" is a query on the map's key**, `{"roles.<user id>": {"$exists": true}}`, served by the wildcard index `roles.$**`.

## What a person may do on a market

`get_user_market_role` resolves a person's role on one market as the higher of two:

1. Their entry in the market's `roles`, if there is one.
2. What their place in the market's organization gives (`organization_market_role`): **Admin** to its owner and its admins, **Viewer** to a member, nothing to anyone else.

The higher of the two (`higher_role`) is the one held, and holding neither means the market is not theirs to see.
**An organization's admins run its markets**, but never as Owner: the Owner is the one entry in `roles` that says so, and deleting the market and changing an admin's role are rows whose role is the Owner, fixed.
Anyone outside the organization who changes a market, a door volunteer included, needs a role on that market (Manage market); [Operations](../../OPERATIONS.md#accounts-and-access) says how to give one.
Removing someone from the organization takes away what it gave them and leaves any role a market gave them.

`user_has_permission` ranks the roles by `ROLE_RANK`, owner 4, admin 3, editor 2, viewer 1, and grants a row when the person's rank reaches the row's role; only [the market's actions](../modules/market-actions.md) calls it, with the row's role.
Every market check asks a row there, and the market read serves the answers for the screens (`readOnlyReason`, `adminActionsReason`), so no screen decides a threshold of its own ([what each role may do](../../business/rules/what-each-role-may-do.md)).
The Markets list (`get_markets_for_user`) is every market with the person's role on it, then every market of their organizations; each entry's `user_role` is the role the market's own read would serve, worked by the same two rules from the documents the list already holds (`_summary_role`, reading the organization from the list's memo), so the card offers Manage to exactly the people the market lets manage it.

## A market's organization

**A market belongs to exactly one organization, fixed at creation.**
`organization_refusal` refuses a market that names no organization, one that does not exist, or one its creator is not in; no write changes `organizationId` afterwards.
Its people see the market, its owner and admins run it, and deleting the organization deletes it, so a market belonging to nothing is a state the product never produces.
`Market.organization_id` stays `Optional` in the model only so that a market stored before this rule still parses.

## Migrations

[`migrations/migrate_roles.py`](../../../back-end/migrations/migrate_roles.py) turned the old `owner`/`editors`/`viewers` lists into the `roles` map and the old flat `users` list into `owner`, `admins` and `members`.
[`migrations/migrate_to_uuid.py`](../../../back-end/migrations/migrate_to_uuid.py) gave users, organizations and markets UUID ids and moved every reference (an organization's people and markets, a market's organization and its role keys) from names and emails to ids.
