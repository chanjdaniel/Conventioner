---
layer: implementation
kind: module
describes:
  - back-end/api/market_actions.py
  - back-end/api/permissions.py#user_has_permission
  - back-end/tests/test_every_check_names_an_action.py
verified: 2026-10-29
sources:
  - E39
  - E39/F01/S01
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

**A refusal is a sentence naming who may**: `refusal_sentence(row)` is "Only <who> may <may_what>.", <who> being "someone who holds a role", "an Editor, an Admin or the owner", "an Admin or the owner" or "the market's owner".
A route answers it as its 403 body, through a `ForbiddenError` or a `{"error": ...}` it returns ([an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md)).

**`roles_row(role)`** is the row that gives or takes a role: Editor and Viewer roles one row, Admin roles (and the Owner role, which a market's one owner already holds) another.

**A story that gates a new action adds a row with `action(...)` and asks it**; it never compares a role itself.
A switch row (on or off rather than a role) arrives with the first story that needs one.

## The rules of a market's life are asked first

The table says only who may.
The rules of a market's life stay where they were and refuse whoever may: an archived market refuses every change (`archived_refusal`, and `_load_market_to_change` for every write that loads through it), verdicts settle on entering assignment (`verdict_refusal`), a vendor is added from the assignment on (`adding_refusal`), the assignment runs only in assignment (`assign_refusal`).
Each check keeps the order it had, so every route answers each person as it did before the table.

## Each route's row

| Row (`id`) | Default | Asked by |
| --- | --- | --- |
| Read the market (`read`) | Viewer, fixed | `GET /markets/:id` (`get_market_for_user`), the applications list, the assignment, statistics, tables, placement history, attendance, pending offers count, the application form and vendor notes reads, `POST /floorplans/export` |
| Export CSV (`export-csv`) | Viewer | `GET /markets/:id/assignment-csv` |
| Change Market Setup (`change-setup`) | Editor | `PUT /markets/:id/name`, `PUT /markets/:id/plan`, `POST /floorplans/upload`, `DELETE /floorplans/<id>`, `POST /floorplans/analyze`, `POST /floorplans/calibrate`, `POST /floorplans/save-to-market` |
| Change the form, the automatic rejections and the review highlights (`change-form`) | Editor | `PUT /markets/:id/application-form`, `PUT /markets/:id/rejection-rules`, `PUT /markets/:id/review-highlights` |
| Amend a locked form (`amend-form`) | Admin | the three `/markets/:id/application-form/amendment` routes |
| Import applications, and start a market from a CSV (`import-applications`) | Admin | the three `/markets/:id/applications/import` routes and the two `/markets/:id/csv-proposal` routes (`_importing_market_document`) |
| Give verdicts and follow-ups (`give-verdicts`) | Editor | every review write through `_reviewer_on` (`verdict_refusal`): a verdict, a selection's verdicts, the next card, a claim, a follow-up's owner; and which follow-up owners the market read offers |
| Move the phase (`move-phase`) | Admin | `POST /markets/:id/transition`, and the seeder's move |
| Publish results (`publish-results`) | Admin | `POST /markets/:id/publish-results` |
| Add a vendor who never applied (`add-vendor`) | Editor | `POST /markets/:id/vendors` |
| Write vendor notes (`write-vendor-notes`) | Editor | `PUT /markets/:id/vendor-notes/<email>` and its `request-handled` |
| Run the assignment, change its rules, and place, swap or free seats (`assign`) | Editor | `POST /markets/:id/assignment`, the three `/markets/:id/placements` writes, `POST /floorplans/place-tables`, and a plan write that changes the assignment rules |
| Check vendors in (`check-in`) | Editor | `POST` and `DELETE /markets/:id/attendance` |
| Give and take Editor and Viewer roles (`manage-editors-and-viewers`) | Admin | `/markets/:id/roles` writes on an Editor or a Viewer |
| Give and take Admin roles (`manage-admins`) | Owner, fixed | `/markets/:id/roles` writes on an Admin (a role change asks the row of the role taken and of the one given) |
| Delete the market (`delete-market`) | Owner, fixed | `DELETE /markets/:id` |
| Change this table (`change-the-table`) | Owner, fixed | nothing yet: the market keeps its own rows in a later story |

**The plan write asks two rows**: Market Setup always, and the Assignment row too when the body changes the assignment rules, which ride in the plan; restating them asks only Market Setup.

**The market read's screen reasons keep their words** until each screen asks its own row (E39/F01/S02): `readOnlyReason` (`change_refusal`) asks Market Setup and says "You can view this market but not change it.", `adminActionsReason` (`admin_actions_refusal`) asks that and then Move the phase, and `publishResultsReason` asks that and then Publish results, in the same words as `adminActionsReason`.
`verdictLockReason` and `addVendorReason` answer with their rows' sentences, which no screen shows.

## Sharp edges

**No source outside this module and `permissions.py` names a role threshold**: `test_no_check_outside_the_actions_module_names_a_role` in [`back-end/tests/test_every_check_names_an_action.py`](../../../back-end/tests/test_every_check_names_an_action.py) searches every server source for a `user_has_permission` or `can_manage_roles` call, `ROLE_RANK`, or a role looked up with `get_user_market_role` and compared to a `MarketRole`, and fails on any.
The same file pins every row's default, label, group and fixed flag against the epic's table, and for each row that its default role may, that every role above may, and that the role below is refused with its sentence; and which row each loader-backed write and read asks.

**A test that fakes who may patches `user_has_permission` or `Actions.refusal`**: the first still sees the row's default role, so a fake that answers by role keeps working.

## Why

- [What each role may do](../../business/rules/what-each-role-may-do.md): the rule the rows keep, and the line that every check reads the table.
- [An archived market is read-only](../../business/rules/an-archived-market-is-read-only.md): one of the rules of a market's life the table never overrides.
- [Publish Results waits for the allocation](../../business/rules/publish-results-waits-for-the-allocation.md): the Publish results row, and the rule its route asks after it.
