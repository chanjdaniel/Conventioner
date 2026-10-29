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
  - E42/F01/S01
---

# What each role may do

A Viewer reads a market and changes nothing; an Editor changes the plan, the form, the seats, the highlights, the automatic rejections and the verdicts, updates a vendor's info, and checks vendors in; an Admin or the owner also moves the phase, publishes results, imports applications, starts the market from a CSV and amends a locked form.
Each screen offers each person only what their role lets them do, and the server decides it.
**Every check reads one table**: each action is a row saying the lowest role that may take it, and the roles below are the rows' built-in defaults ([the market's actions](../../implementation/modules/market-actions.md)).

**Serves:** [A request can only do what its session may](../intents/a-request-can-only-do-what-its-session-may.md).

## Why

A Viewer was once shown every editing control, and each edit appeared to work until its save failed with a 403 (bug 37); an Editor was offered every phase move.
A control the write would refuse is a control that lies, so the market read says, per person, what each write would answer.
An Editor works on the market (the plan, the seats, the review) but takes none of the actions that move it or bring people in or tell them: a phase move puts a public page on or off the air, publishing results tells applicants, an import adds applicants.
A verdict is Editor's (E34/F01/S01): reviewers decide applications, and a verdict records who gave it.
An organization's admins run its markets ([the decision of 2026-10-20](../../records/DECISION_2026-10-20.md)): the admin running a market on the day could read every seat and swap none, because membership gave only Viewer, and giving each admin a role on each market by hand was a step nobody knew to take.

## Who may

| Role | May |
| --- | --- |
| Viewer | read the market: its applications, its result and tables, the statistics and the CSV exports (the assignment's and the vendors'), the floorplan export, attendance and the assignment history |
| Editor | everything a Viewer may, and the plan and its floorplan ([who may use the floorplan routes](../../implementation/modules/floorplan-placement.md#who-may-use-the-floorplan-routes)), the form, renaming a draft, allocating tables and assigning, swapping or freeing a seat, highlights, automatic rejections, verdicts, follow-ups, vendor notes, [updating a vendor's info](an-update-is-kept-beside-the-vendors-answer.md), check-ins at the door |
| Admin | everything an Editor may, and phase moves, publishing results, importing, the CSV start, [the form amendment](../../implementation/modules/form-amendment.md); manage editors and viewers |
| Owner | everything an Admin may, and manage admins, and delete the market |

Whoever creates a market is its owner, and a market has exactly one.
**An organization's owner and admins are Admin on every market it holds, and a member is Viewer.**
A market may also give a person a role of its own; both are held, and the higher one counts: Owner (4) > Admin (3) > Editor (2) > Viewer (1).
So an organization admin once given Viewer on one market is still Admin there, and a member given Editor on one market edits it.
**Nobody is a market's Owner through its organization**: deleting a market and managing its admins stay with the one person who owns it.
Anyone outside the organization who changes a market, a door volunteer included, needs a role on that market (Manage market).
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
- **Who is asking is the session's answer, never the request's.**
  An organizer route learns who is asking from the signed-in session, through `authenticated_email()` ([`back-end/utils/identity.py`](../../../back-end/utils/identity.py)), and a role is looked up for that address alone; no server source reads a caller's identity from a request header.
  [`back-end/tests/test_session_is_the_identity.py`](../../../back-end/tests/test_session_is_the_identity.py) walks the header attack that once read and rejected another organizer's applications, and refuses any server source that reads an identity header again (E07).
- **Adding a person never changes a role.**
  `add_market_role` refuses an address that already has a role on the market, so a role changes only through `update_market_role`, which refuses any change to the owner and lets only the owner change an Admin; adding once overwrote the role, so any Admin, and with T15 any organization admin, could demote the owner and leave the market with nobody to delete or hand it over.
- [`back-end/tests/test_what_a_role_may_change.py`](../../../back-end/tests/test_what_a_role_may_change.py) pins each role's read-only line and its answer for moving the phase; `every-screen-asks-the-table.spec.ts` walks a Viewer, an Editor and an Admin through Market Setup, Applications (the vendor drawer's "Update info" among them), the Assignment tab and Attendance.
- [`back-end/tests/test_an_organizations_admins_run_its_markets.py`](../../../back-end/tests/test_an_organizations_admins_run_its_markets.py) pins the role each place in an organization gives, the higher of two roles, that the Markets list names the same role, and that an organization admin adds and changes only Editors and Viewers; `screens-match-roles.spec.ts` walks an organization admin swapping two seats on market day.
- A follow-up's owner is anyone with a role on the market by this rule, explicit or through its organization, members included ([needs follow-up](needs-follow-up.md)).

## Superseded

Verdicts were an admin action, served on a reason that also stood for moving the phase; they and follow-ups drop to an Editor, and phase moves stay an Admin's (brain-dump/2026-10-19#22, E34/F01/S01).
The screens read five role-shaped reasons, each standing for several rows, and Manage market and the markets list compared the person's role; each screen now asks its own row's answer (E39/F01/S02).
Organization membership gave only Viewer on its markets, even to its owner and admins, and a role on the market replaced the organization's rather than adding to it; an organization's owner and admins became Admin, and the higher role counts (T15, decision/2026-10-20).
