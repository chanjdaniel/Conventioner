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
  - back-end/api/organizations.py#get_history
  - back-end/api/organizations.py#read_organization
  - back-end/api/organizations.py#set_default_permission
  - back-end/api/organizations.py#reset_default_permission
  - back-end/api/organizations.py#reset_default_permissions
  - back-end/api/organizations.py#get_default_permission_history
  - back-end/api/markets.py#create_market
  - front-end/src/views/ManageOrgOverlay.vue
  - front-end/src/components/OrganizationHistory.vue
  - front-end/src/components/OrganizationPermissions.vue
  - back-end/api/permissions.py
  - back-end/api/markets.py#get_markets_for_user
  - back-end/api/markets.py#create_owned_market
  - back-end/api/markets.py#organization_refusal
  - back-end/api/markets.py#add_market_role
  - back-end/api/markets.py#remove_market_role
  - back-end/api/markets.py#update_market_role
verified: 2026-10-31
sources:
  - E20/F04/S01
  - E21/F03/S01
  - E26/F08/S01
  - bug/46
  - T15
  - T85
  - decision/2026-10-20
  - E40/F02/S01
  - E39/F02/S01
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
| `default_permissions` | the rows of the table it sets for the markets it will hold: row id to `{role}`, absent when it sets none ([its default table](#its-default-table)) |

Every key is one word but `default_permissions`, which no other spelling of has ever been written, so the spelling question the market document has does not arise.
Membership is recorded on both sides: each user's `organizations` lists the ids of the organizations they are in, kept in step by every membership write ([users and email](users-and-email.md)).
`get_organizations_for_user` finds a person's organizations with an `$or` over `owner`, `admins` and `members`, each a [lookup index](lookup-indexes.md).

**Who changes an organization**: only the owner renames it, adds an admin or transfers ownership; the owner or an admin adds a member or changes its default table; the owner removes anyone but themselves, an admin only members.
Renaming is all an update does: it reads the body's `name`, a string that is not blank, and nothing else, so the owner, the admins, the members and the markets change only through the writes above, which keep each user's `organizations` in step.
Transferring ownership makes the old owner an admin; transferring it to its own owner is refused before anything is written.
The owner cannot be removed, and an account that owns an organization cannot be deleted until it hands it on.
Deleting an organization is the owner's, deletes the drafts and archived markets it holds, and is refused while it holds a market mid-lifecycle ([when an organization may be deleted](../../business/rules/when-an-organization-may-be-deleted.md), through [market deletion](../modules/market-deletion.md)).
What the owner and the admins do with these, screen by screen, is [the organizations flows](../../business/flows/organizations.md).

## Its default table

**An organization sets the table each market created in it starts with** (E39/F02/S01; Daniel, Q22: "org admins can", "copy").
`default_permissions` holds the rows it sets, each the role it asks; a row it does not set is the row's built-in default, and a fixed row, a row the table does not have or a role this build does not know is read as not set (`organization_rows` in [the market's actions](../modules/market-actions.md#the-organizations-default)).
`get_organizations_for_user` serves it on each organization as `defaultPermissionTable`, every row with its role and source (`organization` or `built-in`), as the market read serves a market's.

**A copy, not a link**: `create_market` copies the rows into the new market's `permissions`, each `{role, source: "organization"}`, whatever the create body carried; a market of no organization, or of one that sets none, starts at the built-in table ([ADR 0019](../../adr/0019-a-markets-permissions-are-a-table.md)).
A later change to the default reaches only markets created after it.
A market's owner takes the organization's current default with "Copy the organization's defaults again" in Manage market (`copy_organization_default`, [the market document](market-document.md)).

**Its owner and its admins change it, its members read it**: `set_default_permission` (`PUT /organizations/:id/default-permissions/<row>`, body `{role}`), `reset_default_permission` (`DELETE` the same path) and `reset_default_permissions` (`DELETE /organizations/:id/default-permissions`, every row in one write) each answer the default table.
Anyone else is refused with "Only the organization's owner or its admins may change its default permissions.", 403, an organization nobody has 404; then an unknown row, a fixed row and a role that is not one of the four, 400, as a market's own writes refuse them.
Setting the role a row already asks, or resetting a row it does not set, writes and records nothing; a stored field that is not a map is replaced by one holding the row, as Mongo cannot set a key inside it, and a whole reset leaves a row this build cannot read where it is.
Manage organization's "Default permissions for new markets" ([`OrganizationPermissions.vue`](../../../front-end/src/components/OrganizationPermissions.vue)) shows it with Manage market's rows and changes; a change confirms first and says it reaches only markets created from now on.

## The organization's history

**Every change to the organization is recorded in [the history](history.md#what-an-organization-records)**, keyed by `organization_id` where a market's entry holds `market_id`: renaming it, an admin or a member added, a member made an admin, either removed, ownership handed on, a market created in it or deleted from it, a floorplan template filed under it added, changed, removed, or moved out of it or into it, and a row of its default table set or reset, or every row reset.
Each is recorded once its change has landed, never fails it, and records nothing when nothing changed: an admin added again, a rename to the name it has.
An organization has no table of who may do what, so its actions are the history's own verbs, one per kind of change; a change with an admin on either side of it is `manage-organization-admins`, a member added or removed `manage-organization-members`, as a market's role changes go under the row their check asked, and ownership handed on is `transfer-organization`.
Creating the organization and deleting it record nothing here: its history starts empty, and the deletion takes the history with it after the [deletion trail](../../business/rules/when-an-organization-may-be-deleted.md) is written.

**Its owner, its admins and its members read it**, in Manage organization's History section ([`ManageOrgOverlay.vue`](../../../front-end/src/views/ManageOrgOverlay.vue), with its entries drawn by [`OrganizationHistory.vue`](../../../front-end/src/components/OrganizationHistory.vue)), through `get_history` (`GET /organizations/:id/history`), a page at a time; anyone else is refused, 403.
So every one of its people has "Manage" on the organization's card; a member's dialog holds the owner, the default permissions (read-only) and the History, and none of the other people or controls the owner and the admins manage.
A change made in the dialog shows in its History as it lands: the section reads its first page again after each.
**The organization itself is its people's too**: `GET /organizations/:id` (`read_organization`) answers its owner, admins and members, and anyone else 403, an organization nobody has 404, as its other routes do; it answered anyone signed in who had its id, its people's ids among it.
The screens read an organization only through the list, `get_organizations_for_user`, which was always scoped.
The first page also names every row of the market's table by its label, for the changes to its default table, recorded under `change-the-default`.
Those changes alone are also read under the default table's section, through `get_default_permission_history` (`GET /organizations/:id/default-permission-history`), by the same people.

## Roles on a market

**A market's `roles` is a map from user id to one role**: `owner`, `admin`, `editor` or `viewer`, with exactly one `owner` (`validate_single_owner` on `Market`).
A map, not one list per role, so nobody can hold two roles on one market.
Whoever creates a market owns it, and only they do (`create_owned_market`): the create body's roles were once taken on trust, so a client could make a market owned by someone else or by nobody (bug 46).
Anyone else is added afterwards by email, through `add_market_role`, which stores their user id; they must already have an account.
The owner's entry cannot be changed, removed or added beside, so a market's ownership cannot be handed on.
An owner manages every other role; an admin manages editors and viewers: the table's two rows for roles, Give and take Admin roles (Owner, fixed) and Give and take Editor and Viewer roles (Admin), which `roles_row` picks by the role given or taken ([the market's actions](../modules/market-actions.md)).
Roles change on an archived market too: they are not a change to its record.

**"Markets this person has a role on" is a query on the map's key**, `{"roles.<user id>": {"$exists": true}}`, served by the wildcard index `roles.$**`.

**Giving, changing and taking a market role records into [the market's history](history.md)** (`role_given`, `role_changed`, `role_taken`), under the Admin row when an Admin or Owner role is either side of it, else the Editor and Viewer row.

## What a person may do on a market

`get_user_market_role` resolves a person's role on one market as the higher of two:

1. Their entry in the market's `roles`, if there is one.
2. What their place in the market's organization gives (`organization_market_role`): **Admin** to its owner and its admins, **Viewer** to a member, nothing to anyone else.

The higher of the two (`higher_role`) is the one held, and holding neither means the market is not theirs to see.
`market_role_of` resolves it the same way for someone already known by id, with the organization already loaded: `people_with_market_role` keeps whoever it gives a role, and the table's `may_be_chosen` asks it of each chosen reviewer and each one offered (E38/F07/S03).
**An organization's admins run its markets**, but never as Owner: the Owner is the one entry in `roles` that says so, and deleting the market and changing an admin's role are rows whose role is the Owner, fixed.
Anyone outside the organization who changes a market, a door volunteer included, needs a role on that market (Manage market); [Operations](../../OPERATIONS.md#accounts-and-access) says how to give one.
Removing someone from the organization takes away what it gave them and leaves any role a market gave them.

`user_has_permission` ranks the roles by `ROLE_RANK`, owner 4, admin 3, editor 2, viewer 1, and grants a row when the person's rank reaches the row's role; only [the market's actions](../modules/market-actions.md) calls it, with the row's role.
Every market check asks a row there, and the market read serves every row's answer for the screens (`actionRefusals`), so no screen decides a threshold of its own ([what each role may do](../../business/rules/what-each-role-may-do.md)).
The Markets list (`get_markets_for_user`) is every market with the person's role on it, then every market of their organizations; each entry's role is the one the market's own read would resolve, worked by the same two rules from the documents the list already holds (`_summary_role`, reading the organization from the list's memo), and the entry's `actionRefusals` are asked of it, so each control the card and Manage market offer is offered to exactly the people the market lets take it.

## A market's organization

**A market belongs to exactly one organization, fixed at creation.**
`organization_refusal` refuses a market that names no organization, one that does not exist, or one its creator is not in; no write changes `organizationId` afterwards.
Its people see the market, its owner and admins run it, and deleting the organization deletes it, so a market belonging to nothing is a state the product never produces.
`Market.organization_id` stays `Optional` in the model only so that a market stored before this rule still parses.

## Migrations

[`migrations/migrate_roles.py`](../../../back-end/migrations/migrate_roles.py) turned the old `owner`/`editors`/`viewers` lists into the `roles` map and the old flat `users` list into `owner`, `admins` and `members`.
[`migrations/migrate_to_uuid.py`](../../../back-end/migrations/migrate_to_uuid.py) gave users, organizations and markets UUID ids and moved every reference (an organization's people and markets, a market's organization and its role keys) from names and emails to ids.
