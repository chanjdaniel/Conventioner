---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#role_action_refusals
  - back-end/api/markets.py#read_only_reason
  - front-end/src/utils/marketActions.ts
  - front-end/src/utils/permissions.ts
  - back-end/api/markets.py#add_market_role
  - back-end/api/market_actions.py
  - back-end/tests/test_what_a_role_may_change.py
  - back-end/tests/test_an_organizations_admins_run_its_markets.py
  - back-end/utils/identity.py
  - back-end/tests/test_the_market_keeps_its_own_rows.py
  - back-end/tests/test_changing_a_verdict_is_its_own_row.py
verified: 2026-10-30
sources:
  - brain-dump/2026-10-19#22
  - E26/F08/S01
  - E34/F01/S01
  - bug/37
  - E07
  - T15
  - decision/2026-10-20
  - E39/F01/S01
  - E39/F01/S02
  - E39/F01/S03
  - E39/F01/S04
  - E42/F01/S01
  - E41/F01/S02
  - E40/F01/S03
  - E38/F06/S01
  - E44/F01/S01
  - E44/F01/S02
  - E39/F02/S01
---

# What each role may do

A Viewer reads a market and changes nothing; an Editor changes the plan, the form, the seats, the highlights and the automatic rejections, gives verdicts, updates a vendor's info, records a vendor's payment, and checks vendors in; an Admin or the owner also changes a verdict already given, overturns an automatic rejection, moves the phase, stops or resumes taking applications, publishes results, imports applications, starts the market from a CSV, and changes what a vendor owes and paid.
Each screen offers each person only what their role lets them do, and the server decides it.
**Every check reads one table**: each action is a row saying the lowest role that may take it, and the roles below are the rows' built-in defaults ([the market's actions](../../implementation/modules/market-actions.md)).
**A market's owner may change its rows, and only its owner**: each row's role on that market, or back to its default; fixed rows (reading the market, managing admins, deleting it, and changing the table itself) change for nobody, and every change is recorded with who made it and when ([ADR 0019](../../adr/0019-a-markets-permissions-are-a-table.md)).
So the table below is what a market allows until its owner says otherwise.

**Serves:** [A request can only do what its session may](../intents/a-request-can-only-do-what-its-session-may.md).

## Why

A Viewer was once shown every editing control, and each edit appeared to work until its save failed with a 403 (bug 37); an Editor was offered every phase move.
A control the write would refuse is a control that lies, so the market read says, per person, what each write would answer.
An Editor works on the market (the plan, the seats, the review) but takes none of the actions that move it or bring people in or tell them: a phase move puts a public page on or off the air, publishing results tells applicants, an import adds applicants.
A verdict is Editor's (E34/F01/S01): reviewers decide applications, and a verdict records who gave it.
**Changing one is an Admin's** (E38/F06/S01, the 2026-10-29 walk): a verdict is approved or rejected, and once given, turning it into the other, sending it back to needs follow-up, or overturning an automatic rejection undoes a decision someone already made, so it is the row "Change a verdict, or overturn an automatic rejection", default Admin.
Deciding a follow-up, approved or rejected, is giving a verdict, not changing one.
An organization's admins run its markets ([the decision of 2026-10-20](../../records/DECISION_2026-10-20.md)): the admin running a market on the day could read every seat and swap none, because membership gave only Viewer, and giving each admin a role on each market by hand was a step nobody knew to take.

## Who may

| Role | May |
| --- | --- |
| Viewer | read the market: its applications, its result and tables, the statistics and the CSV exports (the assignment's and the vendors'), the floorplan export, attendance, and the market's history, in Manage market, the assignment history and a vendor's drawer, and what each vendor owes and paid |
| Editor | everything a Viewer may, and the plan and its floorplan ([who may use the floorplan routes](../../implementation/modules/floorplan-placement.md#who-may-use-the-floorplan-routes)), the form, renaming a draft, allocating tables and assigning, swapping or freeing a seat, highlights, automatic rejections, giving verdicts on open applications and follow-ups, marking and handing on follow-ups, vendor notes, [updating a vendor's info](an-update-is-kept-beside-the-vendors-answer.md), [recording a vendor's payment](../../implementation/data/payments.md) (Daniel, T92 Q15: "editors can"), check-ins at the door |
| Admin | everything an Editor may, and changing a verdict already given (to the other, or back to needs follow-up) and overturning an [automatic rejection](automatic-rejections.md), phase moves, stopping and taking applications, publishing results, importing, the CSV start, [updating an answer the assignment reads](an-update-is-kept-beside-the-vendors-answer.md#who-may), changing what a vendor owes and adjusting what they paid (Daniel, T92 Q26: "this number can be changed by the admin"); manage editors and viewers; connect the market to Discord and choose its role ([the Discord connection](../../implementation/modules/discord.md)) |
| Owner | everything an Admin may, and manage admins, and delete the market |

Whoever creates a market is its owner, and a market has exactly one.
**An organization's owner and admins are Admin on every market it holds, and a member is Viewer.**
A market may also give a person a role of its own; both are held, and the higher one counts: Owner (4) > Admin (3) > Editor (2) > Viewer (1).
So an organization admin once given Viewer on one market is still Admin there, and a member given Editor on one market edits it.
**Nobody is a market's Owner through its organization**: deleting a market and managing its admins stay with the one person who owns it.
Anyone outside the organization who changes a market, a door volunteer included, needs a role on that market (Manage market).
**An organization's owner and admins do not change a market's own rows**: they hold Admin there, and the table is its owner's.
**They set the organization's default instead** (E39/F02/S01, Daniel, Q22: "org admins can", "copy"): each market created in the organization starts with its rows, copied, and a later change reaches only the markets created after it, or one whose owner copies the default again ([the organization's default table](../../implementation/data/organization-document.md#its-default-table)).
See [the organization document](../../implementation/data/organization-document.md#what-a-person-may-do-on-a-market) for how a role is resolved.

## Who signs in, and how

| Person | Signs in how | What they do |
| --- | --- | --- |
| Organizer | Email and password, or an emailed sign-in code | Runs markets, by the role each market gives them |
| Organization owner or admin | As an organizer | Runs every market of their organization as its Admin |
| Organization member | As an organizer | Sees every market of their organization as a Viewer |
| Vendor applying online | A 6-digit code emailed per market; no account | Applies to a market whose vendors apply on its own page, and reads their application ([a vendor signs in before they have applied](a-vendor-signs-in-before-applying.md)) |
| Vendor on market day | Nothing: types the address they applied with | Looks up their table and checks in |

## Where it is kept

- **Every check on a market asks a row of the table** in [`back-end/api/market_actions.py`](../../../back-end/api/market_actions.py), and a refusal is the row's sentence naming who may ("Only an Admin or the owner may move this market's phase."); no check names a role of its own, and [the market's actions](../../implementation/modules/market-actions.md) lists each route's row.
  A rule of the market's life (archived, the verdicts settling, adding from Assignment on) is still asked where it was, and refuses whoever may.
- The market read serves every row's answer for the person asking, `actionRefusals`, asked of the same rows the writes ask, of the role resolved once (`role_action_refusals` in [`back-end/api/markets.py`](../../../back-end/api/markets.py), E39/F01/S02): null where they may, else the archived rule's words where it refuses that row, else the row's sentence.
  `readOnlyReason` (`read_only_reason`) is set when the market is archived, or none of the table's changing rows is the person's.
- **A screen offers a control only on the answer of the action it takes, through `mayTake` and `actionRefusal`** ([`front-end/src/utils/marketActions.ts`](../../../front-end/src/utils/marketActions.ts)); no screen reads the person's role, and Manage market's role helpers ([`front-end/src/utils/permissions.ts`](../../../front-end/src/utils/permissions.ts)) ask the row that gives each role.
  `noScreenComparesARole.test.ts` fails on a source file that compares or ranks a market role, or reads the role the person holds.
  [The market frame](../../implementation/modules/market-frame.md) says `readOnlyReason` once, under the rail, on every page of the market, so a page whose controls are gone is never taken for broken; a page says only its own lock (T15).
  [The phase rail](../../implementation/modules/phase-rail.md) offers no move to someone the Move the phase row refuses, and still says where the market stands.
- **A market keeps the rows it differs on**, in its `permissions`, and every check and the market read ask the market's row where it holds one (`minimum_role`); its owner sets or resets a row through `PUT` and `DELETE /markets/:id/permissions/<action>`, or resets every row through `DELETE /markets/:id/permissions`, each change an entry in [the market's history](../../implementation/data/history.md) with its role before and after.
  [`back-end/tests/test_the_market_keeps_its_own_rows.py`](../../../back-end/tests/test_the_market_keeps_its_own_rows.py) pins that a market without rows reads every default, that an Editor's check-in is refused where "Check vendors in" asks for an Admin and allowed on another market, and each refusal of the write: anyone but the owner (an organization admin included), a fixed row, an unknown row, a role not one of the four, an archived market.
- **Everyone who may read the market reads its table, and everyone who may read its history every change to it**, in Manage market's Permissions section, and only the owner changes it there ([setting who may do what](../flows/ending-and-managing-a-market.md#l3a-set-who-may-do-what), E39/F01/S04).
- **Who is asking is the session's answer, never the request's.**
  An organizer route learns who is asking from the signed-in session, through `authenticated_email()` ([`back-end/utils/identity.py`](../../../back-end/utils/identity.py)), and a role is looked up for that address alone; no server source reads a caller's identity from a request header.
  [`back-end/tests/test_session_is_the_identity.py`](../../../back-end/tests/test_session_is_the_identity.py) walks the header attack that once read and rejected another organizer's applications, and refuses any server source that reads an identity header again (E07).
- **Adding a person never changes a role.**
  `add_market_role` refuses an address that already has a role on the market, so a role changes only through `update_market_role`, which refuses any change to the owner and lets only the owner change an Admin; adding once overwrote the role, so any Admin, and with T15 any organization admin, could demote the owner and leave the market with nobody to delete or hand it over.
- [`back-end/tests/test_what_a_role_may_change.py`](../../../back-end/tests/test_what_a_role_may_change.py) pins each role's read-only line and its answer for moving the phase; `every-screen-asks-the-table.spec.ts` walks a Viewer, an Editor and an Admin through Market Setup, Applications (the vendor drawer's "Update info" among them), the Assignment tab and Attendance.
- [`back-end/tests/test_an_organizations_admins_run_its_markets.py`](../../../back-end/tests/test_an_organizations_admins_run_its_markets.py) pins the role each place in an organization gives, the higher of two roles, that the Markets list names the same role, and that an organization admin adds and changes only Editors and Viewers; `screens-match-roles.spec.ts` walks an organization admin swapping two seats on market day.
- **Giving a verdict and changing one are two rows** (E38/F06/S01): every review write asks "Give verdicts and follow-ups" (`_reviewer_on`), and a verdict or a selection's asks "Change a verdict, or overturn an automatic rejection" too, of each application it writes that is already approved or rejected.
  A single verdict on one is refused with a 403 and the row's sentence ("Only an Admin or the owner may change a verdict or overturn an automatic rejection on this market."), a selection skips each with that sentence, and the write itself refuses one decided since the reviewer saw it, so a verdict landing in between is the 409 it always was.
  A write that judges the automatic rejections again returns what a rule rejected to open only for someone the row lets overturn it ([automatic rejections](automatic-rejections.md)).
  So a change takes both rows (the change row is asked on top of the giving row, `on_top_of`): with the change row set below the giving row, someone the giving row refuses still changes nothing and overturns nothing, by a verdict or by any write that judges the rules again, and is told the giving row's words.
  [`back-end/tests/test_changing_a_verdict_is_its_own_row.py`](../../../back-end/tests/test_changing_a_verdict_is_its_own_row.py) pins each role and each move, and a market whose owner moved the row.
- A follow-up's owner is anyone with a role on the market by this rule, explicit or through its organization, members included ([needs follow-up](needs-follow-up.md)).

## Superseded

Verdicts were an admin action, served on a reason that also stood for moving the phase; they and follow-ups drop to an Editor, and phase moves stay an Admin's (brain-dump/2026-10-19#22, E34/F01/S01).
One row covered giving a verdict and changing one, so an Editor could turn an approval into a rejection or overturn an automatic rejection as freely as they gave a first verdict; changing one became its own row, default Admin (E38/F06/S01).
The screens read five role-shaped reasons, each standing for several rows, and Manage market and the markets list compared the person's role; each screen now asks its own row's answer (E39/F01/S02).
Every market answered by the built-in table alike; a market now keeps the rows its owner changed (E39/F01/S03).
Organization membership gave only Viewer on its markets, even to its owner and admins, and a role on the market replaced the organization's rather than adding to it; an organization's owner and admins became Admin, and the higher role counts (T15, decision/2026-10-20).
