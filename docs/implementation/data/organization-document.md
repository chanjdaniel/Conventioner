---
layer: implementation
kind: data
describes:
  - back-end/datatypes.py#Organization
  - back-end/datatypes.py#OrganizationRole
  - back-end/datatypes.py#MarketRole
  - back-end/api/organizations.py#create_organization
  - back-end/api/organizations.py#organization_documents_of
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
  - back-end/tests/test_the_market_list_shows_what_the_read_serves.py
  - back-end/tests/test_removing_someone_already_gone.py
  - back-end/api/markets.py#create_owned_market
  - back-end/api/markets.py#organization_refusal
  - back-end/api/markets.py#add_market_role
  - back-end/api/markets.py#remove_market_role
  - back-end/api/markets.py#update_market_role
  - back-end/datatypes.py#people_from_lists
  - back-end/datatypes.py#organization_people_of
  - back-end/organization_people.py#of_person
  - back-end/migrations/migrate_organization_people.py
  - back-end/tests/test_migrate_organization_people.py
  - back-end/tests/test_a_roll_forward_rebuilds_the_people_from_the_lists.py
  - back-end/tests/test_a_persons_organizations_in_either_shape.py
  - back-end/api/organizations.py#change_org_place
verified: 2026-11-12
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
  - E38/F12/S01
  - E38/F15/S01
  - T181
  - T204
  - T224
  - T217
  - T263
  - T274
  - T283
---

# The organization document, and roles

One document per organization in the `organizations` collection, and the roles a person holds on an organization and on each market.
[`back-end/api/organizations.py`](../../../back-end/api/organizations.py) writes the organization; [`back-end/api/permissions.py`](../../../back-end/api/permissions.py) resolves what a person may do on a market; the market's own `roles` map is written by `api/markets.py` ([`back-end/api/markets.py`](../../../back-end/api/markets.py)).
The models are `Organization`, `OrganizationRole` and `MarketRole` in [`back-end/datatypes.py`](../../../back-end/datatypes.py).

The glossary concept: [Organization and roles](../../business/concepts/organization-and-roles.md).

## The organization

| Field                 | What it is                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                  | a UUID, the primary key; the name is a display field                                                                                                      |
| `name`                | creating one with a name another organization has is refused ("Organization already exists"); a rename is not checked, and no index holds the name unique |
| `people`              | its people, user id to `owner`, `admin` or `member`, exactly one `owner`, so a person has one place ([one map of people](#one-map-of-people))             |
| `owner`               | the user id of its one owner, kept beside `people` for one release                                                                                        |
| `admins`, `members`   | user ids, kept beside `people` for one release; an organization stored before `people` is read from them, folded                                          |
| `markets`             | the ids of its markets, added when a market is created and pulled when one is deleted                                                                     |
| `theme`               | carried, never applied                                                                                                                                    |
| `default_permissions` | the rows of the table it sets for the markets it will hold: row id to `{role}`, absent when it sets none ([its default table](#its-default-table))        |

Every key is one word but `default_permissions`, which no other spelling of has ever been written, so the spelling question the market document has does not arise.
Membership is recorded on both sides: each user's `organizations` lists the ids of the organizations they are in, kept in step by every membership write ([users and email](users-and-email.md)).
`organization_documents_of` finds a person's organizations with `organization_people.of_person`'s filter ([one map of people](#one-map-of-people)) and answers the stored documents; the Markets list reads them so, since it needs no person's address and no count of what removing someone takes (`get_markets_for_user` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)), and `test_the_list_reads_its_readers_organizations_without_their_people_or_removals` in [`back-end/tests/test_the_market_list_shows_what_the_read_serves.py`](../../../back-end/tests/test_the_market_list_shows_what_the_read_serves.py) fails when it reads either.
`get_organizations_for_user` makes the same find, then reads every owner, admin and member of all of them in one `get_users_by_ids` ([users and email](users-and-email.md#lookups)), never one account at a time, so an organization of 150 members costs the Organizations page and Manage organization one read of them (T204).
It serves each organization's `owner`, `admins` and `members` as its people map gives them, in the map's order, whatever its stored lists hold, and its admins and members as `{userId, email}` pairs, `adminPeople` and `memberPeople`, in the same order, an account that is gone left out, and the owner's address as `ownerEmail`.
Manage organization draws its rows from the pairs, each section a [list frame](../../design-system.md) over them, and each row keyed and removed by its own `userId`: it paired the address list with `admins` by position, so one deleted account shifted every later row onto the next person's id, and Remove could name one person and remove another.
`adminEmails` and `memberEmails`, with their snake-case twins, are the same people by address alone, deprecated and kept only for a tab still on the old bundle; the next release removes them.
[`test_the_organizations_read_names_everyone_at_once.py`](../../../back-end/tests/test_the_organizations_read_names_everyone_at_once.py) pins the one read and the pairs, a deleted admin among them, an organization with a map served from it and one stored before it served folded.
It serves each with what removing someone from it takes (E38/F15/S01): `marketCount`, its markets counted from the markets themselves by their indexed `organizationId`, since `markets` is kept in step only at best effort, and `marketsWithOwnRole`, each admin's and member's count of those markets whose own `roles` name them, since removing them from the organization leaves those roles; Manage organization's Remove says both ([remove a person](../../business/flows/organizations.md#b3-remove-a-person)), and the organization's card says `marketCount`; the front end reads no organization's `markets` list.

**Who changes an organization**: only the owner renames it, adds an admin, changes someone's place between admin and member, or transfers ownership; the owner or an admin adds a member or changes its default table; the owner removes anyone but themselves, an admin only members.
A person's place changes only through [the organization's people](../modules/organization-people.md), whose table says each of these and refuses the rest: "Add admin" of a member makes them an admin, the owner's `PUT /organizations/<org_id>/users/<user_id>` with `{"place": "admin" | "member"}` makes a member an admin or an admin a member (the place they hold already answers 200 and writes nothing, the owner's place is refused), "Add admin" of an admin and "Add member" of a member say they already are, 400, and adding the owner or an admin as a member is refused as before.
Renaming is all an update does: it reads the body's `name`, a string that is not blank, and nothing else, so the owner, the admins, the members and the markets change only through the writes above, which keep each user's `organizations` in step.
Transferring ownership hands the organization to one of its admins or members and makes the old owner an admin; transferring it to its own owner, or to someone outside it ("Hand the organization only to one of its admins or members."), is refused before anything is written.
The owner cannot be removed, and an account that owns an organization cannot be deleted until it hands it on.
Removing someone who is neither an admin nor a member, another organizer having removed them first, answers 404 "They are no longer in this organization." before any write, as does a removal whose write finds them gone under it; nothing is recorded, and Manage organization reads that 404 as done ([remove a person](../../business/flows/organizations.md#b3-remove-a-person)); a market role taken twice answers alike ([roles on a market](#roles-on-a-market)).
Deleting an organization is the owner's, deletes the drafts and archived markets it holds, and is refused while it holds a market mid-lifecycle ([when an organization may be deleted](../../business/rules/when-an-organization-may-be-deleted.md), through [market deletion](../modules/market-deletion.md)).
What the owner and the admins do with these, screen by screen, is [the organizations flows](../../business/flows/organizations.md).

## One map of people

**An organization's people are one map, `people`, from user id to place** (T283, [ADR 0025](../../adr/0025-an-organizations-people-are-one-map.md)), the shape a market's `roles` has, so a person stands in one place by construction.
`Organization` holds it and derives `owner`, `admins` and `members` from it, in the map's order, whatever lists its input held; it refuses a map with no owner or two, "An organization has exactly one owner", and one whose places are not the three.

**An organization stored before the map is read folded** by `people_from_lists` in [`back-end/datatypes.py`](../../../back-end/datatypes.py): the owner gets `owner`, then each id in `admins` not yet placed gets `admin`, then each in `members` not yet placed gets `member`, in list order, and a value that is not a list reads as an empty one.
So the owner wins over any list they also stand in: an organization whose owner was also in `admins` or `members` failed the model, so the market read treated it as absent and its admins and members lost every role through it with nothing said, and it parses and grants again.
`organization_people_of(document)` is the one rule every reader of a raw document reads its people by, the stored map when there is one, else the fold: `_role_in`, `_what_removing_takes` and `get_organizations_for_user` here, the membership and owner checks in [`back-end/api/floorplans_templates.py`](../../../back-end/api/floorplans_templates.py), `organization_refusal` in [`back-end/api/markets.py`](../../../back-end/api/markets.py), and `delete_user`'s owner check in [`back-end/api/users.py`](../../../back-end/api/users.py); a `people` that is not a map reads as nobody there, and fails the model.
Readers holding an `Organization`, the permissions, the market read and the Markets list, read its derived `owner`, `admins` and `members`.

**"The organizations this person is in" is one filter**, `of_person(user_id)` in [`back-end/organization_people.py`](../../../back-end/organization_people.py): an `$or` of their key in `people`, `{"people.<id>": {"$exists": true}}`, served by the wildcard index `people.$**` as `roles.$**` serves a market's, and, on an organization with no `people`, its `owner`, `admins` or `members`, each a [lookup index](lookup-indexes.md).
An organization with a map is never found by a stale list.
`organization_documents_of`, `get_user_organizations` in [`back-end/api/permissions.py`](../../../back-end/api/permissions.py) and the account deletion use it, and [`test_a_persons_organizations_in_either_shape.py`](../../../back-end/tests/test_a_persons_organizations_in_either_shape.py) pins it finding both shapes alike, with its server twin in [the real-MongoDB suite](../testing/real-mongo-suite.md).
It refuses, as a `RuntimeError`, an id that is not a non-empty string or that holds a `.` or starts with `$`, since the id becomes a dotted path; an id reaches it only from a stored account.

**One writer keeps the map, and the lists as its mirror**: `create_organization` inserts `people: {<owner id>: "owner"}` beside the lists, and adding an admin or a member, changing someone's place, removing someone, transferring ownership and an account's deletion go through [the organization's people](../modules/organization-people.md), each one conditional write holding the places it judged.
On an organization with a map the write holds the requester's and the target's keys as read and moves one key, keeping `admins` and `members` in step with `$addToSet` and `$pull`; on one stored before the map it holds `owner`, `admins` and `members` as read and sets `people` whole beside the three lists as its mirror, so the first change to such an organization folds it.
A write that met another change answers 404 when the organization or the person being removed is gone, else `OrganizationChanged`, 409, and Manage organization says its sentence where that control's refusal shows and reads the organization again.
Transferring ownership is one such write, filtered on the giver being owner: it sets both keys and `owner`, keeps the lists in step, and, handed to an admin, sets `admins` whole and holds it as read, so the organization never stands with two owners, none, or an owner in a list, whatever is cut or read in between ([the transfer's write](../modules/organization-people.md#every-write-holds-what-it-judged)).

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
Manage organization's "Default permissions for new markets" ([`OrganizationPermissions.vue`](../../../front-end/src/components/OrganizationPermissions.vue)) is a line in Manage organization and a dialog over it (T217), showing the table with Manage market's rows and changes; a change confirms first and says it reaches only markets created from now on.

## The organization's history

**Every change to the organization is recorded in [the history](history.md#what-an-organization-records)**, keyed by `organization_id` where a market's entry holds `market_id`: renaming it, an admin or a member added, a member made an admin, either removed, ownership handed on, a market created in it or deleted from it, a floorplan template filed under it added, changed, removed, or moved out of it or into it, and a row of its default table set or reset, or every row reset.
Each is recorded once its change has landed, never fails it, and records nothing when nothing changed: a rename to the name it has; an admin added again is refused, 400, and records nothing either.
An organization has no table of who may do what, so its actions are the history's own verbs, one per kind of change; a change with an admin on either side of it is `manage-organization-admins`, a member added or removed `manage-organization-members`, as a market's role changes go under the row their check asked, and ownership handed on is `transfer-organization`.
Creating the organization and deleting it record nothing here: its history starts empty, and the deletion takes the history with it after the [deletion trail](../../business/rules/when-an-organization-may-be-deleted.md) is written.

**Its owner, its admins and its members read it**, in Manage organization's History section ([`ManageOrgOverlay.vue`](../../../front-end/src/views/ManageOrgOverlay.vue), with its entries drawn by [`OrganizationHistory.vue`](../../../front-end/src/components/OrganizationHistory.vue)), through `get_history` (`GET /organizations/:id/history`), 25 at a time as the end of its box scrolls into view ([`PagedList`](../../../front-end/src/components/PagedList.vue)); anyone else is refused, 403.
So every one of its people has "Manage" on the organization's card; a member's dialog holds the owner, the default permissions (read-only) and the History, and none of the other people or controls the owner and the admins manage.
A change made in the dialog shows in its History as it lands: the section reads its first page again after each.
A first page that fails says so in its place, "The history could not be loaded." unless the failure says more, with "Try again", which reads it again ([`ReadFailed`](../../../front-end/src/components/ReadFailed.vue)), as the market's history does.
**The organization itself is its people's too**: `GET /organizations/:id` (`read_organization`) answers its owner, admins and members, and anyone else 403, an organization nobody has 404, as its other routes do; it answered anyone signed in who had its id, its people's ids among it.
The screens read an organization only through the list, `get_organizations_for_user`, which was always scoped.
The first page also names every row of the market's table by its label, for the changes to its default table, recorded under `change-the-default`.
Those changes alone are also read in the default table's dialog, through `get_default_permission_history` (`GET /organizations/:id/default-permission-history`), by the same people.

## Roles on a market

**A market's `roles` is a map from user id to one role**: `owner`, `admin`, `editor` or `viewer`, with exactly one `owner` (`validate_single_owner` on `Market`).
A map, not one list per role, so nobody can hold two roles on one market.
Whoever creates a market owns it, and only they do (`create_owned_market`): the create body's roles were once taken on trust, so a client could make a market owned by someone else or by nobody (bug 46).
Anyone else is added afterwards by email, through `add_market_role`, which stores their user id; they must already have an account.
The owner's entry cannot be changed, removed or added beside through a role write; the owner hands the market on instead (`hand_on_market`, the fixed row `hand-on-market`, T283), to anyone the market read finds with access, in one write that sets `roles.<owner>` to `admin` and `roles.<new>` to `owner`, holding both keys as read, so the market has exactly one owner before it and after it, and a second hand-on on the same read answers the market write's 409 ([the market's actions](../modules/market-actions.md#hand-the-market-on-hand-on-market)).
An account that owns a market is not deleted: `delete_user` reads `{"roles.<user id>": "owner"}` and refuses while it finds one, until the owner hands the market on or deletes it ([deleting an account](users-and-email.md#deleting-an-account)).
An owner manages every other role; an admin manages editors and viewers: the table's two rows for roles, Give and take Admin roles (Owner, fixed) and Give and take Editor and Viewer roles (Admin), which `roles_row` picks by the role given or taken ([the market's actions](../modules/market-actions.md)).
Roles change, and a market is handed on, on an archived market too: neither is a change to its record.
Taking a role nobody holds, another organizer having taken it first, answers 404 "They no longer have a role on this market.", as does a removal whose write finds it gone under it, and records nothing; `remove_market_role` asks both roles rows before it looks at the person, so someone who may take no role there is refused in one sentence whoever the person is, the only owner, an Admin, anyone else or nobody, and Manage market reads the 404 as done ([`test_removing_someone_already_gone.py`](../../../back-end/tests/test_removing_someone_already_gone.py), with its organization twin [above](#the-organization)).

**Each role write sets or takes one person's key, never the whole map** (T274): giving and changing `$set` `roles.<user id>`, taking `$unset`s it, through [the market write](../modules/market-write.md), holding the phase, as every market write does, and that person's role and the requester's as read, so two admins changing roles at the same moment never undo each other, and a role taken never comes back.
A write that met roles changed since its read stores nothing and answers the market write's 409; a take whose person is already gone answers the 404 above instead.

**"Markets this person has a role on" is a query on the map's key**, `{"roles.<user id>": {"$exists": true}}`, served by the wildcard index `roles.$**`.

**Giving, changing and taking a market role records into [the market's history](history.md)** (`role_given`, `role_changed`, `role_taken`), under the Admin row when an Admin or Owner role is either side of it, else the Editor and Viewer row; handing the market on records `handed_on` under its own row.

## What a person may do on a market

`get_user_market_role` resolves a person's role on one market as the higher of two:

1. Their entry in the market's `roles`, if there is one.
2. What their place in the market's organization gives (`organization_market_role`): **Admin** to its owner and its admins, **Viewer** to a member, nothing to anyone else.

The higher of the two (`higher_role`) is the one held, and holding neither means the market is not theirs to see.
`market_role_of` resolves it the same way for someone already known by id, with the organization already loaded: `people_with_market_role` keeps whoever it gives a role, and the table's `may_be_chosen` asks it of each chosen reviewer and each one offered (E38/F07/S03).
`people_with_access` lists each of them, for Manage market, at the role that counts with the market's own and their place in the organization (`admin` for its owner and admins, `member` for a member) beside it, and whether the organization's role is the one that counts, which it is when it reaches the market's own, a tie included (E38/F12/S01).
**An organization's admins run its markets**, but never as Owner: the Owner is the one entry in `roles` that says so, and deleting the market and changing an admin's role are rows whose role is the Owner, fixed.
Anyone outside the organization who changes a market, a door volunteer included, needs a role on that market (Manage market); [Operations](../../OPERATIONS.md#accounts-and-access) says how to give one.
Removing someone from the organization takes away what it gave them and leaves any role a market gave them.

`user_has_permission` ranks the roles by `ROLE_RANK`, owner 4, admin 3, editor 2, viewer 1, and grants a row when the person's rank reaches the row's role; only [the market's actions](../modules/market-actions.md) calls it, with the row's role.
Every market check asks a row there, and the market read serves every row's answer for the screens (`actionRefusals`), so no screen decides a threshold of its own ([what each role may do](../../business/rules/what-each-role-may-do.md)).
The Markets list (`get_markets_for_user`) is every market with the person's role on it, then every market of their organizations, each kept only where the market's own read would serve it to them (T181).
It reads each document as the read does (`_readable_market`), resolves the person's role by the read's rule (`_summary_role`, through `market_role_of`, with the organization parsed as the read parses it, from the list's memo, so an organization whose document fails validation grants nothing through it here either) and asks the read's question of that role (`read_refused`).
A document the model refuses is logged by `_log_unreadable_market` and left out with the rest still listed, and a market whose read row refuses the person is left out too, so no card opens onto "not found".
The entry's `actionRefusals` are asked of the same role, and of whether the reader is a chosen reviewer (`is_chosen`, by their address, as the read asks it), so each control the card and Manage market offer is offered to exactly the people the market lets take it.
[`back-end/tests/test_the_market_list_shows_what_the_read_serves.py`](../../../back-end/tests/test_the_market_list_shows_what_the_read_serves.py) pins it at the Flask client: every listed market opens for its reader, and an unknown role in a roles map or an organization that does not parse (its people name no owner) leaves the market out of the list as it leaves it out of the read, an organization stored with its owner also in `admins` grants its admins Admin and its members Viewer in both, and a chosen Viewer's entry answers every row as their read does.

## A market's organization

**A market belongs to exactly one organization, fixed at creation.**
`organization_refusal` refuses a market that names no organization, one that does not exist, or one its creator is not in; no write changes `organizationId` afterwards.
Its people see the market, its owner and admins run it, and deleting the organization deletes it, so a market belonging to nothing is a state the product never produces.
`Market.organization_id` stays `Optional` in the model only so that a market stored before this rule still parses.

## Migrations

[`migrations/migrate_roles.py`](../../../back-end/migrations/migrate_roles.py) turned the old `owner`/`editors`/`viewers` lists into the `roles` map and the old flat `users` list into `owner`, `admins` and `members`.
[`migrations/migrate_to_uuid.py`](../../../back-end/migrations/migrate_to_uuid.py) gave users, organizations and markets UUID ids and moved every reference (an organization's people and markets, a market's organization and its role keys) from names and emails to ids.
[`migrations/migrate_organization_people.py`](../../../back-end/migrations/migrate_organization_people.py) folds every organization stored before the map into its `people` (T283, [ADR 0025](../../adr/0025-an-organizations-people-are-one-map.md)), in the write a change makes on such an organization (`organization_people.folding_write`): held on `people` absent and the three lists as read, it sets the fold and the lists as its mirror.
It skips and lists an organization with no owner, one holding an id that cannot be a key of the map, and one that changed between its read and its write, which a second run folds.
Its `--dry-run` writes nothing and prints each organization it would fold, what it holds, and whether it does not parse on the release before (its owner also an admin or a member) or lists an admin also as a member, then the counts.
Nothing waits on it, since every reader reads both shapes: it runs after the deploy, whenever ([RELEASING.md](../../RELEASING.md#pre-deploy-database-migrations)).
[`test_migrate_organization_people.py`](../../../back-end/tests/test_migrate_organization_people.py) folds each stored shape, and pins the dry run, a second run and a change landing during the run; [`test_an_organizations_people_on_the_server.py`](../../../back-end/tests/real_mongo/test_an_organizations_people_on_the_server.py) runs the same on a server.
Its `--reconcile` is for a roll forward over a rollback past the map's release, and only then: the release before writes only the lists, so the maps it left are stale, and every reader prefers the map ([Rolling back](../../RELEASING.md#rolling-back)).
It folds as above, and rebuilds each folded organization's map from its lists wherever the two disagree, each person still in it keeping their position, in one write held on the map and the three lists as read (`organization_people.reconciling_write`) that sets the lists as the new map's mirror.
[`test_a_roll_forward_rebuilds_the_people_from_the_lists.py`](../../../back-end/tests/test_a_roll_forward_rebuilds_the_people_from_the_lists.py) replays each change the release before makes by its own writes and reads the organization as the market read does once reconciled, and pins an organization in step never written, the dry run, a second run and a change landing during the run, and that the reconcile keeps a transfer judged on the stale map before it ran; the real-MongoDB file above runs the rebuild and the change landing during the run on a server.
