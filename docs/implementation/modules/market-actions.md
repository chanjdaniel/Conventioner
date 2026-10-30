---
layer: implementation
kind: module
describes:
  - back-end/api/market_actions.py
  - back-end/api/permissions.py#user_has_permission
  - back-end/api/permissions.py#role_reaches
  - back-end/tests/test_every_check_names_an_action.py
  - back-end/api/markets.py#role_action_refusals
  - back-end/api/markets.py#ARCHIVED_STILL_TAKES
  - back-end/api/markets.py#deprecated_screen_reasons
  - back-end/tests/test_every_screen_asks_the_table.py
  - back-end/api/markets.py#set_permission
  - back-end/api/markets.py#reset_permission
  - back-end/api/markets.py#get_permission_history
  - back-end/tests/test_the_market_keeps_its_own_rows.py
verified: 2026-10-30
sources:
  - E39
  - E39/F01/S01
  - E39/F01/S02
  - E39/F01/S03
  - E42/F01/S01
---

# The market's actions

[`back-end/api/market_actions.py`](../../../back-end/api/market_actions.py) is the table of who may do what on a market: one row per action, each saying the lowest role that may take it.
Every permission check on a market in the back end asks a row, and none names a role of its own.
The rows are the rule [what each role may do](../../business/rules/what-each-role-may-do.md), and their built-in defaults are the thresholds each check held before the table existed (E39/F01/S01).
A market keeps the rows it differs on, and its owner changes them (E39/F01/S03, [ADR 0019](../../adr/0019-a-markets-permissions-are-a-table.md)).

## The interface

**A row is an `Action`**: a stable `id`, its `group` and `label` (the epic's table), its `default` (a `MarketRole`, meaning that role and every one above it, Owner > Admin > Editor > Viewer), `may_what` (the words after "may" in its refusal) and `fixed` (a row nobody may change).
`action(...)` adds a row to `ACTIONS` and returns it, and refuses an id the table already has; each row is a module constant (`MOVE_PHASE`, `ASSIGN`, ...).

**One question answers every check**: `refusal(row, user_email, market, organization)` is None when the person may, or the row's sentence when they may not; `may(...)` is the same as a bool.
The row asks the role `minimum_role(row, market)` gives: the market's own row where it holds one, else the row's default (below).
The person's role is the one `get_user_market_role` resolves (the market's own and the one its organization gives, the higher counting, [the organization document](../data/organization-document.md#what-a-person-may-do-on-a-market)), and `refusal` ranks it through `user_has_permission` in [`back-end/api/permissions.py`](../../../back-end/api/permissions.py), which nothing else calls.
`role_refusal(row, role, rows)` asks a row of a role already resolved, on a market holding `rows`, for the market read, which resolves the person's role once, and the markets list, which resolves each entry's role from the documents it holds (`_summary_role`) and passes the document's stored rows; both rank through `role_reaches`, the one ranking.

**A refusal is a sentence naming who may**: `refusal_sentence(row, required)` is "Only <who> may <may_what>.", <who> naming `required`, the role the row asks on the market refusing (its default when not given): "someone who holds a role", "an Editor, an Admin or the owner", "an Admin or the owner" or "the market's owner".
So with "Check vendors in" set to Admin on a market, an Editor there is told "Only an Admin or the owner may check vendors in at this market."
A route answers it as its 403 body, through a `ForbiddenError` or a `{"error": ...}` it returns ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md)).

**`roles_row(role)`** is the row that gives or takes a role: Editor and Viewer roles one row, Admin roles (and the Owner role, which a market's one owner already holds) another.

**A story that gates a new action adds a row with `action(...)` and asks it**; it never compares a role itself.
A switch row (on or off rather than a role) arrives with the first story that needs one.

## The rules of a market's life keep their place

The table says only who may.
The rules of a market's life stay where they were and refuse whoever may: an archived market refuses every change (`archived_refusal`, and `_load_market_to_change` for every write that loads through it), verdicts settle on entering assignment (`verdict_refusal`), a vendor is added from Assignment on (`adding_refusal`), tables are allocated only in Assignment (`assign_refusal`).
Each check keeps the order it had, so every route answers each person as it did before the table: a write that loads through `_load_market_to_change`, `market_refusal`, `_importing_market_document`, `save_floorplan_to_market` and publish-results ask the row first and the archived rule after it; `verdict_refusal` asks the archived rule first.

## Each route's row

| Row (`id`) | Default | Asked by |
| --- | --- | --- |
| Read the market (`read`) | Viewer, fixed | `GET /markets/:id` (`get_market_for_user`), the applications list, the assignment, statistics, the Stats tab's figures (`GET /markets/:id/stats`, `get_market_stats`), tables, placement history, attendance, pending offers count, the application form and vendor notes reads, `POST /floorplans/export` |
| Export CSV (`export-csv`) | Viewer | `GET /markets/:id/assignment-csv`, `POST /markets/:id/vendor-export` and its `/preview` |
| Change Market Setup (`change-setup`) | Editor | `PUT /markets/:id/name`, `PUT /markets/:id/plan`, `POST /floorplans/upload`, `DELETE /floorplans/<id>`, `POST /floorplans/analyze`, `POST /floorplans/calibrate`, `POST /floorplans/save-to-market`, `POST /floorplans/place-tables` |
| Change the form, the automatic rejections and the review highlights (`change-form`) | Editor | `PUT /markets/:id/application-form`, `PUT /markets/:id/rejection-rules`, `PUT /markets/:id/review-highlights` |
| Amend a locked form (`amend-form`) | Admin | the three `/markets/:id/application-form/amendment` routes |
| Import applications, and start a market from a CSV (`import-applications`) | Admin | the three `/markets/:id/applications/import` routes and the two `/markets/:id/csv-proposal` routes (`_importing_market_document`) |
| Give verdicts and follow-ups (`give-verdicts`) | Editor | every review write through `_reviewer_on` (`verdict_refusal`): a verdict, a selection's verdicts, the next card, a claim, a follow-up's owner; and which follow-up owners the market read offers |
| Move the phase (`move-phase`) | Admin | `POST /markets/:id/transition`, and the seeder's move |
| Publish results (`publish-results`) | Admin | `POST /markets/:id/publish-results` |
| Add a vendor who never applied (`add-vendor`) | Editor | `POST /markets/:id/vendors` |
| Write vendor notes (`write-vendor-notes`) | Editor | `PUT /markets/:id/vendor-notes/<email>` and its `request-handled` |
| Allocate tables, change the assignment rules, and assign, swap or free seats (`assign`) | Editor | `POST /markets/:id/assignment`, the three `/markets/:id/placements` writes, and a plan write that changes the assignment rules |
| Check vendors in (`check-in`) | Editor | `POST` and `DELETE /markets/:id/attendance` |
| Give and take Editor and Viewer roles (`manage-editors-and-viewers`) | Admin | `/markets/:id/roles` writes on an Editor or a Viewer |
| Give and take Admin roles (`manage-admins`) | Owner, fixed | `/markets/:id/roles` writes on an Admin (a role change asks the row of the role taken and of the one given) |
| Delete the market (`delete-market`) | Owner, fixed | `DELETE /markets/:id` |
| Change this table (`change-the-table`) | Owner, fixed | `PUT` and `DELETE /markets/:id/permissions/<action>` (`set_permission`, `reset_permission`) |

**The plan write asks two rows**: Market Setup always, and the Assignment row too when the body changes the assignment rules, which ride in the plan; restating them asks only Market Setup.

## A market's own rows

**A market stores only the rows it differs on**, in `permissions` on [the market document](../data/market-document.md): a map from action id to `{role, source}` (`MarketPermission` in [`back-end/datatypes.py`](../../../back-end/datatypes.py)), `source` being `market` (changed here by its owner) or `organization` (copied from the organization's default at creation, which E39/F02 writes).
A row the market does not hold reads its default, so a market without the field reads the built-in table and needs no migration.
`held_row(row, rows)` is the market's own row or None: never for a fixed row, whatever is stored, nor for a stored role or source this build does not know, nor for a row of the wrong shape, and a stored id the table no longer has is never asked.
**A stored row this build cannot read never fails the market's read**: `MarketPermission` keeps its role and source as plain strings, so an unknown value parses and reads as the default, and `Market` drops a row of the wrong shape as it parses (not a map, no string role or source, or `permissions` not a map at all; `drop_unreadable_permissions` in [`back-end/datatypes.py`](../../../back-end/datatypes.py)), so the read, every write and the markets list read such a row alike, as its default.
Only the owner's write stores a row, so neither happens unless a document was changed by hand or by a later build.
`create_market` writes `permissions: {}` whatever the create body carried.

**`table(market)` is the table for display**, served on the market read as `permissionTable`: every row in order with its `id`, `group`, `label`, the `role` it asks here, its `default`, its `source` (`built-in`, `organization` or `market`) and whether it is `fixed`.
A control asks `actionRefusals`, never this.

**One write, the owner's only**: `PUT /markets/:id/permissions/<action>` with `{"role": "admin"}` sets the row (`set_permission`), and `DELETE` on the same path returns it to its built-in default (`reset_permission`); each answers the market's table.
Both load through `_load_market_to_change` with the fixed row `change-the-table`, so anyone but the market's one owner is refused with "Only the market's owner may change who may do what on this market." (an organization's owner and admins hold Admin, never Owner), and so is an archived market, in the archived rule's words.
Then the row: one the table does not have is "This market's table has no such row.", a fixed one "Who may take the row "<label>" is fixed, so it cannot be changed.", and a role other than the four stored values is "A row's role is one of viewer, editor, admin or owner."; every refusal is a 400 or 403 with its sentence, and stores and records nothing.
Setting the role a row already asks, or resetting a row the market does not hold, stores and records nothing.
Setting writes `permissions.<action>` to `{role, source: market}`, and resetting unsets it, whether it was changed here or copied from the organization.

**Every change is recorded** in [the market's history](../data/history.md): the `change-the-table` action, kind `permission_set` or `permission_reset`, subject `{action}` and detail `{before, after}`, each `{role, source}`.
`GET /markets/:id/permission-history` (`get_permission_history`, at Read) answers `{entries}`, the market's history narrowed to them, newest first.
[`back-end/tests/test_the_market_keeps_its_own_rows.py`](../../../back-end/tests/test_the_market_keeps_its_own_rows.py) pins the read, the write, each refusal, the record, and a changed row reaching the checks, the read and the markets list.

## What the screens read

**The market read serves every row's answer for the person asking**, `actionRefusals`, by row id (`role_action_refusals` in [`back-end/api/markets.py`](../../../back-end/api/markets.py), E39/F01/S02): null where they may, else why not.
`get_market_for_user` resolves the person's role once, as `refusal` resolves it, and asks each row `role_refusal` of it, so the answer is the writes' and the role is resolved once rather than once per row; where the archived rule refuses the row's writes its words come first, as the screens always said them, so the yes and no are the writes' and only who is told which reason first differs.
`ARCHIVED_STILL_TAKES` lists the rows an archived market still takes: reading and exporting it, giving and taking roles, and deleting it; every other row, one added later included, is refused on an archived market.
`TestEveryRowOfTheTable` in [`back-end/tests/test_an_archive_is_read_only.py`](../../../back-end/tests/test_an_archive_is_read_only.py) sends one write of every row to an archived market, and fails when a row outside the set is not refused in the archived rule's words or a row inside it is; the phase move is refused there by the transition table, since no move leaves `archived`.
The markets list serves the same answers, through the same function, for each entry's role, so a card offers Manage on the row that gives roles.

**`readOnlyReason` is set when the market is archived, or none of the table's changing rows is the person's** (`read_only_reason`; reading and exporting change nothing), in the words "You can view this market but not change it."; [the market frame](market-frame.md) says it once on every page.

**The rules of a market's life the rows carried are served on their own**: `verdictsSettledReason` (the review has closed), `addingVendorsReason` (a vendor is added from the assignment on) and `publishWaitsReason` (results wait for the allocation); a screen offers the action when neither its row nor its rule refuses.
The role-shaped reasons the screens read before (`adminActionsReason`, `verdictLockReason`, `addVendorReason`, `publishResultsReason`) and the person's `user_role` are deprecated: no screen reads them, but the back end deploys before the front end and a tab keeps its bundle until it reloads, and an old bundle takes a missing reason for "allowed".
So the read serves them for one more release, each its row's answer and then the rule it carried (`deprecated_screen_reasons`; `adminActionsReason` is the Import applications row's, since the old bundle says its words only on the import screens), and the next release removes them; `change_refusal`, `admin_actions_refusal` and `add_vendor_refusal` are gone.

**A screen asks through [`front-end/src/utils/marketActions.ts`](../../../front-end/src/utils/marketActions.ts)**: `MarketAction` names every row by its id, `actionRefusal(market, action)` is the answer and `mayTake(market, action)` the same as a bool, and a missing answer refuses, so a read that predates a row offers nothing.
`test_the_screens_name_exactly_the_tables_rows` in [`back-end/tests/test_every_screen_asks_the_table.py`](../../../back-end/tests/test_every_screen_asks_the_table.py), which pins every answer the read serves, fails when the front end's ids and the table's differ, and `noScreenComparesARole.test.ts` when a source file compares or ranks a market role, or reads the role the person holds.

**A write that changes a market records into [the market's history](../data/history.md) under its row's id**, and `back-end/tests/test_every_write_records.py` fails on a write route or a row that records nothing unless it says why there.

## Sharp edges

**No source outside this module and `permissions.py` names a role threshold**: `test_no_check_outside_the_actions_module_names_a_role` in [`back-end/tests/test_every_check_names_an_action.py`](../../../back-end/tests/test_every_check_names_an_action.py) searches every other server source for any use of `user_has_permission`, `can_manage_roles` or `ROLE_RANK`, and of the role resolvers `get_user_market_role`, `organization_market_role` and `higher_role` outside the two functions that serve the role itself to the client (`get_market_for_user`, `_summary_role`), and fails on any.
Holding a role is how a check would compare one, so searching for the resolvers catches a comparison in any shape, inline, against a tuple, through an annotated name or kept on an attribute, and an import of any of these names by name is flagged too, since an alias (`from api.permissions import ROLE_RANK as R`) would hide every later use; `test_the_search_finds_a_check_that_names_a_role` pins each shape.
The two functions that serve the role are allowed by module and name, so a function of the same name elsewhere is still searched.
The search cannot see a raw read of `market.roles` or `organization.admins`: comparing a stored role there looks, by syntax, exactly like keeping the one-owner invariant (`add_market_role` refusing a second owner), so such a read is for review to catch.
The same file pins every row's default, label, group and fixed flag against the epic's table, and for each row that its default role may, that every role above may, and that the role below is refused with its sentence; and which row each loader-backed write and read asks.

**A test that fakes who may patches `user_has_permission` or `Actions.refusal`**: the first still sees the role the row asks on the market (its default unless the market holds the row), so a fake that answers by role keeps working.

## Why

- [What each role may do](../../business/rules/what-each-role-may-do.md): the rule the rows keep, and the line that every check reads the table.
- [An archived market is read-only](../../business/rules/an-archived-market-is-read-only.md): one of the rules of a market's life the table never overrides.
- [Publish Results waits for the allocation](../../business/rules/publish-results-waits-for-the-allocation.md): the Publish results row, and the rule its route asks after it.
