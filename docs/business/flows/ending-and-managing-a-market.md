---
layer: business
kind: flow
describes:
  - front-end/src/views/ManageMarketOverlay.vue
  - front-end/src/components/MarketPermissions.vue
  - front-end/src/components/PermissionRows.vue
  - front-end/src/components/PermissionChanges.vue
  - front-end/src/utils/permissionTable.ts
  - front-end/e2e/the-permissions-section.spec.ts
verified: 2026-10-31
sources:
  - E20/F01/S03
  - E21/F03/S04
  - E26/F06
  - E30/F01/S03
  - E31/F02/S03
  - E32/F01/S01
  - bug/8
  - bug/9
  - bug/30
  - bug/37
  - bug/43
  - bug/47
  - T15
  - E40/F01/S03
  - E40/F01/S04
  - E39/F01/S04
  - E39/F02/S01
---

# Ending and managing a market

**Who:** the market's Admin or owner archives it and manages who has access; only the owner deletes it and changes who may do what; everyone who may read the market opens Manage market and reads it ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the phase rail, to archive; the Markets list's "Manage", to manage, set who may do what, read the history, rename or delete ([finding a market](finding-a-market.md#c2-the-markets-list)).
**Serves:** [The door on market day](../intents/the-door-on-market-day.md) and [A request can only do what its session may](../intents/a-request-can-only-do-what-its-session-may.md).

A market ends by being archived, after its market days or before it ever runs, or it is deleted outright.
Managing it is the "Manage market" dialog ([`ManageMarketOverlay.vue`](../../../front-end/src/views/ManageMarketOverlay.vue)), which names the market and holds, in order, its people ("Users with access"), who may do what, its history ("History", [reading the market's history](reading-the-markets-history.md)), its organization, its name and its deletion.

## P6. Ending early, or not at all

| Situation | Flows |
| --- | --- |
| Abandon a market before it runs | [L2](#l2-abandon-a-market-early) |
| Remove a market entirely | [L5](#l5-delete-a-market) |
| Wind up an organization and every market in it | [B5a to B5c](organizations.md#b5-delete-an-organization) |
| Return a market to draft to fix its form before anyone applies | [F5](form-tab.md#f5-reopen-the-market-to-fix-the-form) |

## L1. Archive after market days

**Status:** Works (re-walked live on 2026-10-03; archiving as the step onward and the landing read from the code as of E31/F02/S03 and E32/F01/S01).

1. Once every market date has passed, "Archive Market" is the rail's main button and the rail says "The market has run. Archive it to keep it as the record of what happened."; until then it is under More….
2. "Archive this market?": "Archiving is permanent. Once archived, a market cannot be returned to an active phase. This action cannot be undone." and "Its check-in page stays up as a record: vendors can still look up where they were assigned, but nobody can check in."; focus on Cancel; "Archive".
3. Expect the rail frozen with "This market is archived. It was published and ran its market days." (bug 8), landing on Assignments; every page is read only (bug 30), and Attendance keeps the record, every vendor who never checked in reading "Did not come".
4. The check-in page stays up as a record: "This market has ended. You can still look up where you were placed, and when you checked in.", each date "Checked in" or "Not checked in", and no check-in (bug 9).

Covered by: `phase-state-machine.spec.ts`, `an-archive-keeps-its-check-in-page.spec.ts`, `an-archive-is-read-only.spec.ts`.

## L2. Abandon a market early

**Status:** Works (walked live; the notes' words read from the code, `PhaseRail.vue`).
More…, "Archive Market" from any earlier phase, with the same confirmation less the check-in line.
It is read only, lands on Assignments if it was assigned and on Market Setup if not, and no check-in page is served.
The rail's note says how far it got: "It was abandoned before it opened applications.", "It opened applications but never allocated tables." or "Its tables were allocated but it was never published, so no check-in page went on the air."; a market older than the phase record says only what it can prove ("It opened applications.", "Its tables were allocated.").
Its Attendance tab says "This market was archived without being published, so nobody checked in."
Covered by: `an-archive-is-read-only.spec.ts` ("an archived market that never ran says it has no attendance"), `an-archive-keeps-its-check-in-page.spec.ts`, `market-remembers-phases.spec.ts`.

## L3. Manage who has access

**Status:** Works (walked live; the owner's row and the refusals read from the code as of E20/F01/S03 and bug 43's fix).

1. "Manage" opens "Manage market"; "Users with access" lists each person with an explicit role.
2. A role the reader may change is a dropdown of the roles they may give (Admin, Editor, Viewer); any other role, the owner's always, is stated as a word, not offered.
3. "Remove" beside each person the reader may remove; never the owner.
4. "Add user", for an Admin or the owner only (bug 37): the email, the role, "Add", and "Cancel" on the same row.
   An address that already has a role on the market is refused beneath the row, pointing to that person's own row: adding once overwrote any role, the owner's too, around the guards a role change keeps (T15).
5. A refused change is said beneath that person's row, which keeps the role they hold.

The organization line says "Belongs to <organization>. Its members can view it."
Covered by: `tier2.spec.ts` ("add user, change role, and remove user from market"), `access-control.spec.ts`, `the-manage-market-dialog-holds-together.spec.ts`.

## L3a. Set who may do what

**Status:** Works (E39/F01/S04; read from the code and driven by `the-permissions-section.spec.ts`).

1. "Permissions", after "Users with access", is closed until "Show" opens it, and says beneath its heading "Who may do what on this market." with "Every row is at its built-in default." or how many rows differ from the built-in defaults.
2. Open, it lists every row of [the market's table](../../implementation/modules/market-actions.md#a-markets-own-rows) under its group, in the table's order: its label, where its role came from ("Built-in default", "Copied from the organization" for a row its organization's default set when the market was created ([B8](organizations.md#b8-set-the-default-permissions-for-new-markets)), or "Changed on this market by <address>, <when>", from the row's newest change), and its role as "Viewer and above", "Editor and above", "Admin and above" or "Owner only".
3. For the owner each row that is not fixed is a dropdown of those four, named by the row's label, whose arrow keys open its list rather than step it, since each step would be a change to confirm; a fixed row ("Read the market...", "Give and take Admin roles", "Delete the market", "Change this table") states its role with "Always" and no control.
   "Give and take Editor and Viewer roles" says beside it that at "Viewer and above" any Viewer can make themself an Editor, since one row asks for both the role given and the role taken.
4. Choosing a role asks first, in words naming who may after it and who loses or gains it ("Let only Admins and the owner check vendors in at this market?", "Editors lose this."), and for that row lowered to Viewer adds "A Viewer could then make themself an Editor."; "Change" saves that row alone, Cancel puts the dropdown back, and a refusal is said in the confirmation.
5. "Reset to built-in defaults" lists each row it returns, from its role now to its default, opens on Cancel since it throws away every row the owner set, and resets them all in one write, recorded as one change; it is disabled while every row is at its default, so after a reset focus goes to the section's toggle rather than back to it.
6. "Copy the organization's defaults again", beside it for the owner of a market that belongs to an organization, asks first ("Copy the organization's defaults again?", saying every row takes the organization's default as it is now, a row it does not set returns to its built-in default, and rows changed on this market are replaced), opens on Cancel, and copies them in one write, recorded as one change; each copied row then says "Copied from the organization".
7. "Changes" lists the market's history narrowed to the table, newest first, ten at a time with "Load more" as the market's History pages: the row, its role before and after ("Editor to Admin"), or "Reset to built-in defaults" or "Copied the organization's defaults" with each row it changed, and who made it and when, by their address, as "Users with access" names people.
   It is the market's history, so someone the row "Read the market's history" refuses (an owner may raise it above the roles that see this section) has no "Changes", and a row changed on this market says only "Changed on this market".
8. For anyone but the owner the section is read-only and says "Only the market's owner changes these."; on an archived market, the owner included, it says the archived words instead.

Beneath Permissions, "History", closed until opened, lists every change on the market, newest first, for whoever may read the market's history: [L6](reading-the-markets-history.md#l6-read-the-markets-history).

A change reaches every screen at its next read of the market: the section shows the table the write answers, and the market open in the store, when it is this one, is re-read, as a rename re-reads it.
The section is [`MarketPermissions.vue`](../../../front-end/src/components/MarketPermissions.vue), its rows and its changes the shared [`PermissionRows.vue`](../../../front-end/src/components/PermissionRows.vue) and [`PermissionChanges.vue`](../../../front-end/src/components/PermissionChanges.vue) that Manage organization's default permissions show too, its three confirmations teleported beside Manage market as a dialog opened from a dialog is ([dialogs](../../implementation/conventions/dialogs.md)); the words are [`front-end/src/utils/permissionTable.ts`](../../../front-end/src/utils/permissionTable.ts)'s, and the server keeps the table and its changes structured.
Covered by: [`the-permissions-section.spec.ts`](../../../front-end/e2e/the-permissions-section.spec.ts), `the-organizations-default.spec.ts` for the copy again, `permissionTable.test.ts`, `marketPermissions.test.ts`, `manageIsOfferedToWhoeverReads.test.ts`, and the sweeps and `every-control-is-named.spec.ts`, which walk the section open.

## L4. Rename a market

**Status:** Works (walked live in Draft).
"Rename market", with the name and "Save", in Draft only; afterwards "This market's public web address comes from its name, and it has already been shared, so its name can no longer change.", and an archived market says it is archived.
Covered by: `public-address.spec.ts`.

## L5. Delete a market

**Status:** Works (walked live; what it names read from the code as of bug 43's fix and E30/F01/S03).
Owner only, in any phase: "Delete market" opens "Delete <market>?", which names what goes ("This deletes the market with its applications, its assignments, its check-in records and the record of who changed what. It cannot be undone."), adds "Its application page and check-in page will stop working for anyone who has the link." for whichever of those it has, and opens on Cancel (bug 43).
Everything the market kept beside itself is deleted with it (bug 47).
Covered by: `tier2.spec.ts`, `the-manage-market-dialog-holds-together.spec.ts`, `market-records-go-with-it.spec.ts`.

## The rules it obeys

- [An archived market is read-only](../rules/an-archived-market-is-read-only.md): roles and deletion are not changes.
- [An archived market that ran stays a record](../rules/an-archived-market-that-ran-stays-a-record.md).
- [What each role may do](../rules/what-each-role-may-do.md).
- [When an organization may be deleted](../rules/when-an-organization-may-be-deleted.md): the other way a market goes.

What deleting takes with it is [market deletion](../../implementation/modules/market-deletion.md).
Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
