---
layer: implementation
kind: module
describes:
  - back-end/api/market_actions.py
  - back-end/api/permissions.py#user_has_permission
  - back-end/tests/test_every_check_names_an_action.py
  - back-end/api/markets.py#role_action_refusals
  - back-end/api/markets.py#deprecated_screen_reasons
  - back-end/tests/test_every_screen_asks_the_table.py
verified: 2026-10-29
sources:
  - E39
  - E39/F01/S01
  - E39/F01/S02
---

# The market's actions

[`back-end/api/market_actions.py`](../../../back-end/api/market_actions.py) is the table of who may do what on a market: one row per action, each saying the lowest role that may take it.
Every permission check on a market in the back end asks a row, and none names a role of its own.
The rows are the rule [what each role may do](../../business/rules/what-each-role-may-do.md), and their built-in defaults are the thresholds each check held before the table existed (E39/F01/S01).

## The interface

**A row is an `Action`**: a stable `id`, its `group` and `label` (the epic's table), its `default` (a `MarketRole`, meaning that role and every one above it, Owner > Admin > Editor > Viewer), `may_what` (the words after "may" in its refusal) and `fixed` (a row nobody may change).
`action(...)` adds a row to `ACTIONS` and returns it, and refuses an id the table already has; each row is a module constant (`MOVE_PHASE`, `ASSIGN`, ...).

**One question answers every check**: `refusal(row, user_email, market, organization)` is None when the person may, or the row's sentence when they may not; `may(...)` is the same as a bool.
The person's role is the one `get_user_market_role` resolves (the market's own and the one its organization gives, the higher counting, [the organization document](../data/organization-document.md#what-a-person-may-do-on-a-market)), and `refusal` ranks it through `user_has_permission` in [`back-end/api/permissions.py`](../../../back-end/api/permissions.py), which nothing else calls.
`role_refusal(row, role)` asks a row of a role already resolved, for the markets list, which resolves each entry's role from the documents it holds (`_summary_role`); both rank through `role_reaches`, the one ranking.

**A refusal is a sentence naming who may**: `refusal_sentence(row)` is "Only <who> may <may_what>.", <who> being "someone who holds a role", "an Editor, an Admin or the owner", "an Admin or the owner" or "the market's owner".
A route answers it as its 403 body, through a `ForbiddenError` or a `{"error": ...}` it returns ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md)).

**`roles_row(role)`** is the row that gives or takes a role: Editor and Viewer roles one row, Admin roles (and the Owner role, which a market's one owner already holds) another.

**A story that gates a new action adds a row with `action(...)` and asks it**; it never compares a role itself.
A switch row (on or off rather than a role) arrives with the first story that needs one.

## The rules of a market's life keep their place

The table says only who may.
The rules of a market's life stay where they were and refuse whoever may: an archived market refuses every change (`archived_refusal`, and `_load_market_to_change` for every write that loads through it), verdicts settle on entering assignment (`verdict_refusal`), a vendor is added from the assignment on (`adding_refusal`), the assignment runs only in assignment (`assign_refusal`).
Each check keeps the order it had, so every route answers each person as it did before the table: a write that loads through `_load_market_to_change`, `market_refusal`, `_importing_market_document`, `save_floorplan_to_market` and publish-results ask the row first and the archived rule after it; `verdict_refusal` asks the archived rule first.

## Each route's row

| Row (`id`) | Default | Asked by |
| --- | --- | --- |
| Read the market (`read`) | Viewer, fixed | `GET /markets/:id` (`get_market_for_user`), the applications list, the assignment, statistics, tables, placement history, attendance, pending offers count, the application form and vendor notes reads, `POST /floorplans/export` |
| Export CSV (`export-csv`) | Viewer | `GET /markets/:id/assignment-csv` |
| Change Market Setup (`change-setup`) | Editor | `PUT /markets/:id/name`, `PUT /markets/:id/plan`, `POST /floorplans/upload`, `DELETE /floorplans/<id>`, `POST /floorplans/analyze`, `POST /floorplans/calibrate`, `POST /floorplans/save-to-market`, `POST /floorplans/place-tables` |
| Change the form, the automatic rejections and the review highlights (`change-form`) | Editor | `PUT /markets/:id/application-form`, `PUT /markets/:id/rejection-rules`, `PUT /markets/:id/review-highlights` |
| Amend a locked form (`amend-form`) | Admin | the three `/markets/:id/application-form/amendment` routes |
| Import applications, and start a market from a CSV (`import-applications`) | Admin | the three `/markets/:id/applications/import` routes and the two `/markets/:id/csv-proposal` routes (`_importing_market_document`) |
| Give verdicts and follow-ups (`give-verdicts`) | Editor | every review write through `_reviewer_on` (`verdict_refusal`): a verdict, a selection's verdicts, the next card, a claim, a follow-up's owner; and which follow-up owners the market read offers |
| Move the phase (`move-phase`) | Admin | `POST /markets/:id/transition`, and the seeder's move |
| Publish results (`publish-results`) | Admin | `POST /markets/:id/publish-results` |
| Add a vendor who never applied (`add-vendor`) | Editor | `POST /markets/:id/vendors` |
| Write vendor notes (`write-vendor-notes`) | Editor | `PUT /markets/:id/vendor-notes/<email>` and its `request-handled` |
| Run the assignment, change its rules, and place, swap or free seats (`assign`) | Editor | `POST /markets/:id/assignment`, the three `/markets/:id/placements` writes, and a plan write that changes the assignment rules |
| Check vendors in (`check-in`) | Editor | `POST` and `DELETE /markets/:id/attendance` |
| Give and take Editor and Viewer roles (`manage-editors-and-viewers`) | Admin | `/markets/:id/roles` writes on an Editor or a Viewer |
| Give and take Admin roles (`manage-admins`) | Owner, fixed | `/markets/:id/roles` writes on an Admin (a role change asks the row of the role taken and of the one given) |
| Delete the market (`delete-market`) | Owner, fixed | `DELETE /markets/:id` |
| Change this table (`change-the-table`) | Owner, fixed | nothing yet: the market keeps its own rows in a later story |

**The plan write asks two rows**: Market Setup always, and the Assignment row too when the body changes the assignment rules, which ride in the plan; restating them asks only Market Setup.

## What the screens read

**The market read serves every row's answer for the person asking**, `actionRefusals`, by row id (`role_action_refusals` in [`back-end/api/markets.py`](../../../back-end/api/markets.py), E39/F01/S02): null where they may, else why not.
`get_market_for_user` resolves the person's role once, as `refusal` resolves it, and asks each row `role_refusal` of it, so the answer is the writes' and the role is resolved once rather than once per row; where the archived rule refuses the row's writes its words come first, as the screens always said them, so the yes and no are the writes' and only who is told which reason first differs.
`ARCHIVED_STILL_TAKES` lists the rows an archived market still takes: reading and exporting it, giving and taking roles, and deleting it; every other row, one added later included, is refused on an archived market.
The markets list serves the same answers, through the same function, for each entry's role, so a card offers Manage on the row that gives roles.

**`readOnlyReason` is set when the market is archived, or none of the table's changing rows is the person's** (`read_only_reason`; reading and exporting change nothing), in the words "You can view this market but not change it."; [the market frame](market-frame.md) says it once on every page.

**The rules of a market's life the rows carried are served on their own**: `verdictsSettledReason` (the review has closed), `addingVendorsReason` (a vendor is added from the assignment on) and `publishWaitsReason` (results wait for the allocation); a screen offers the action when neither its row nor its rule refuses.
The role-shaped reasons the screens read before (`adminActionsReason`, `verdictLockReason`, `addVendorReason`, `publishResultsReason`) and the person's `user_role` are deprecated: no screen reads them, but the back end deploys before the front end and a tab keeps its bundle until it reloads, and an old bundle takes a missing reason for "allowed".
So the read serves them for one more release, each its row's answer and then the rule it carried (`deprecated_screen_reasons`; `adminActionsReason` is the Import applications row's, since the old bundle says its words only on the import screens), and the next release removes them; `change_refusal`, `admin_actions_refusal` and `add_vendor_refusal` are gone.

**A screen asks through [`front-end/src/utils/marketActions.ts`](../../../front-end/src/utils/marketActions.ts)**: `MarketAction` names every row by its id, `actionRefusal(market, action)` is the answer and `mayTake(market, action)` the same as a bool, and a missing answer refuses, so a read that predates a row offers nothing.
`test_the_screens_name_exactly_the_tables_rows` in [`back-end/tests/test_every_screen_asks_the_table.py`](../../../back-end/tests/test_every_screen_asks_the_table.py), which pins every answer the read serves, fails when the front end's ids and the table's differ, and `noScreenComparesARole.test.ts` when a source file compares or ranks a market role, or reads the role the person holds.

## Sharp edges

**No source outside this module and `permissions.py` names a role threshold**: `test_no_check_outside_the_actions_module_names_a_role` in [`back-end/tests/test_every_check_names_an_action.py`](../../../back-end/tests/test_every_check_names_an_action.py) searches every other server source for any use of `user_has_permission`, `can_manage_roles` or `ROLE_RANK`, and of the role resolvers `get_user_market_role`, `organization_market_role` and `higher_role` outside the two functions that serve the role itself to the client (`get_market_for_user`, `_summary_role`), and fails on any.
Holding a role is how a check would compare one, so searching for the resolvers catches a comparison in any shape, inline, against a tuple, through an annotated name or kept on an attribute, and an import of any of these names by name is flagged too, since an alias (`from api.permissions import ROLE_RANK as R`) would hide every later use; `test_the_search_finds_a_check_that_names_a_role` pins each shape.
The two functions that serve the role are allowed by module and name, so a function of the same name elsewhere is still searched.
The search cannot see a raw read of `market.roles` or `organization.admins`: comparing a stored role there looks, by syntax, exactly like keeping the one-owner invariant (`add_market_role` refusing a second owner), so such a read is for review to catch.
The same file pins every row's default, label, group and fixed flag against the epic's table, and for each row that its default role may, that every role above may, and that the role below is refused with its sentence; and which row each loader-backed write and read asks.

**A test that fakes who may patches `user_has_permission` or `Actions.refusal`**: the first still sees the row's default role, so a fake that answers by role keeps working.

## Why

- [What each role may do](../../business/rules/what-each-role-may-do.md): the rule the rows keep, and the line that every check reads the table.
- [An archived market is read-only](../../business/rules/an-archived-market-is-read-only.md): one of the rules of a market's life the table never overrides.
- [Publish Results waits for the allocation](../../business/rules/publish-results-waits-for-the-allocation.md): the Publish results row, and the rule its route asks after it.
