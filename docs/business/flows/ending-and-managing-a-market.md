---
layer: business
kind: flow
describes:
  - front-end/src/views/ManageMarketOverlay.vue
  - front-end/src/utils/peopleWithAccess.ts
  - front-end/e2e/everyone-with-access.spec.ts
  - front-end/src/components/MarketPermissions.vue
  - front-end/src/components/PermissionRows.vue
  - front-end/src/components/PermissionChanges.vue
  - front-end/src/utils/permissionTable.ts
  - front-end/e2e/the-permissions-section.spec.ts
  - front-end/e2e/removing-someone-asks-first.spec.ts
  - front-end/e2e/changing-a-role-asks-first.spec.ts
  - front-end/src/utils/openInsteadOfStepping.ts
  - front-end/e2e/people-at-scale-market.spec.ts
  - front-end/src/components/HandOnMarketDialog.vue
  - front-end/e2e/handing-a-market-on.spec.ts
verified: 2026-11-11
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
  - T142
  - E38/F12/S01
  - E38/F15/S01
  - T181
  - T211
  - T217
  - T204
  - T224
  - T263
  - T274
  - T273
  - T283
---

# Ending and managing a market

**Who:** the market's Admin or owner archives it and manages who has access; only the owner deletes it, hands it on and changes who may do what; everyone who may read the market opens Manage market and reads it ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the phase rail, to archive; the Markets list's "Manage", to manage, set who may do what, read the history, rename, hand on or delete ([finding a market](finding-a-market.md#c2-the-markets-list)).
**Serves:** [The door on market day](../intents/the-door-on-market-day.md) and [A request can only do what its session may](../intents/a-request-can-only-do-what-its-session-may.md).

A market ends by being archived, after its market days or before it ever runs, or it is deleted outright.
Managing it is the "Manage market" dialog ([`ManageMarketOverlay.vue`](../../../front-end/src/views/ManageMarketOverlay.vue)), which names the market and holds, in order, its people ("Users with access"), who may do what, its history ("History", [reading the market's history](reading-the-markets-history.md)), its organization, its name, handing it on and its deletion.
It opens from `/markets`, which fits a phone (T142), so on a phone it opens inside the window like every [dialog](../../implementation/conventions/dialogs.md), and its history's before-and-after table wraps its cells within the dialog's width rather than widening it.
Only its body scrolls, so its title and close stay in view however long the people and the history run.
On a phone each person under "Users with access" puts their address on a line of its own, with their role and Remove beneath it, so a long address is not squeezed into a narrow column; a market role the organization's makes add nothing is said on a line of its own beneath those, with its Remove beneath that line at the start, where every other row's Remove sits.
The "Add user" row does the same: its email field takes the row, with the role at the start of a row beneath it and "Add" and "Cancel" at that row's end; beside them the field and the role were 66px each, reading "User e" and "Edi" (T142).

## P6. Ending early, or not at all

| Situation                                                      | Flows                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| Abandon a market before it runs                                | [L2](#l2-abandon-a-market-early)                         |
| Remove a market entirely                                       | [L5](#l5-delete-a-market)                                |
| Wind up an organization and every market in it                 | [B5a to B5c](organizations.md#b5-delete-an-organization) |
| Return a market to draft to fix its form before anyone applies | [F5](form-tab.md#f5-reopen-the-market-to-fix-the-form)   |

Covered by:

- `org-deletion.spec.ts`

## L1. Archive after market days

**Status:** Works (re-walked live on 2026-10-03; archiving as the step onward and the landing read from the code as of E31/F02/S03 and E32/F01/S01).

1. Once every market date has passed, "Archive market" is the rail's main button and the rail says "The market has run. Archive it to keep it as the record of what happened."; until then it is under More….
2. "Archive this market?": "Archiving is permanent. Once archived, a market cannot be returned to an active phase. This action cannot be undone." and "Its vendor page stays up as a record: vendors can still read where they sat and when they came, but nobody can check in."; focus on Cancel; "Archive".
3. Expect the rail frozen with "This market is archived. It was published and ran its market days." (bug 8), landing on Assignments; every page is read only (bug 30), and Attendance keeps the record, every vendor who never checked in reading "Did not come".
4. The vendor page stays up as a record: each vendor, signed in, reads "Where you sat", "This market has ended.", each date "Checked in at <time>" or "Not checked in", and no check-in (bug 9).

Covered by:

- `an-archive-is-read-only.spec.ts`
- `an-archive-keeps-its-vendor-page.spec.ts`
- `phase-state-machine.spec.ts`

## L2. Abandon a market early

**Status:** Works (walked live; the notes' words read from the code, `PhaseRail.vue`).
More…, "Archive market" from any earlier phase, with the same confirmation less the vendor page line.
It is read only, lands on Assignments if it was assigned and on Market Setup if not, and keeps no record of check-ins; a Google Form market that never published its results has no vendor page.
The rail's note says how far it got: "It was abandoned before it opened applications.", "It opened applications but never allocated tables." or "Its tables were allocated but it was never published, so it never ran its market days."; a market older than the phase record says only what it can prove ("It opened applications.", "Its tables were allocated.").
Its Attendance tab says "This market was archived without being published, so nobody checked in."
Covered by:

- `an-archive-is-read-only.spec.ts` ("an archived market that never ran says it has no attendance")
- `an-archive-keeps-its-vendor-page.spec.ts`
- `market-remembers-phases.spec.ts`

## L3. Manage who has access

**Status:** Works (the owner's row and the refusals read from the code as of E20/F01/S03 and bug 43's fix; the organization's people as of E38/F12/S01, driven by `everyone-with-access.spec.ts`; a role change's confirmation as of T211, driven by `changing-a-role-asks-first.spec.ts`).

1. "Manage" opens "Manage market"; "Users with access" lists everyone with a role on the market, by its own roles or through its organization, each once at the role that counts: the owner first, then Admin, Editor and Viewer, then by address, so someone just added takes their place in that order, never the top.
   The market read serves the list in that order as `peopleWithAccess` ([one market, from the server](../../implementation/conventions/one-market-from-the-server.md)), and the dialog words each row with [`peopleWithAccess.ts`](../../../front-end/src/utils/peopleWithAccess.ts).
   The organization's people are listed only to a reader who belongs to the organization or may give and take Editor and Viewer roles here; anyone else reads the market's own roles alone ([what each role may do](../rules/what-each-role-may-do.md)).
   The list is a [list frame](../../design-system.md), so 154 people never push "Add user" and the sections below 4,900px down: it says "Showing 50 of 154", draws 50 rows and "Show 50 more", and past 12 people has a field, "Find in users with access", that finds by any part of an address, capitals aside, since an account holds no name.
   The words last as long as the dialog and never reach the address; a role change, a removal and the re-read after them keep the words and the rows shown, and only new words go back to the first 50.
   An address breaks before its "@" or a dot, never just after a hyphen, drawn by [`EmailAddress.vue`](../../../front-end/src/components/EmailAddress.vue).
2. A role that comes from the organization says where: "Admin, through <organization>" for its owner and admins, "Viewer, through <organization>" for a member, with no select and no Remove, since only Manage organization changes it.
   A person whose market role adds nothing beside the organization's (the organization's reaches it, a tie included) reads, under that, "Also Editor on this market: this adds nothing while they are an admin of <organization>." ("a member of" for a member), with a Remove that takes only the market role, to tidy it away.
3. A market role that counts, the organization's being lower or none, is a dropdown of the roles the reader may give (Admin, Editor, Viewer); any other role, the owner's always, is stated as a word, not offered.
   Its arrow keys open its list rather than step it ([`openInsteadOfStepping.ts`](../../../front-end/src/utils/openInsteadOfStepping.ts)), since each step would be a change to confirm.
   Choosing a role asks first, since one slip of the dropdown changed someone's access at once (T211): "Make e2e@example.com an Editor?", then "They are a Viewer on Spring Market now." and what the move changes, read from this market's own table.
   Moving up lists under "As an Editor they could also:" the rows above the role held, up to the role chosen; moving down lists under "As a Viewer they could no longer:" the rows above the role chosen, up to the role held; with no row between them it says "This market's permissions treat the two roles alike, so nothing they may do changes."
   It is not a destructive dialog, since another change undoes it, and only its body scrolls, so the question and "Change role" stay in sight above and below Viewer to Admin's list.
   Cancel, Escape and the backdrop put the dropdown back on the role held and give it focus, with nothing sent; "Change role" writes the role, the list re-reads in place with the dialog open, and focus is on the dropdown, or on the list when the re-read leaves that row without one, as it does for someone who changed their own role, or moves the row past those shown.
4. "Remove" beside each such person the reader may remove; never the owner.
   It asks first, in a destructive confirmation that opens on Cancel (E38/F15/S01): "Remove walk390@example.com from Spring Market?", then "They lose their Editor role on it." and, for someone in the organization, "They can still view it as a member of <organization>." ("run it as an admin of" for an admin).
   Cancel and Escape change nothing and give focus back to that Remove; "Remove" takes the market role, the list re-reads in place with the dialog open, and focus goes to the list; a refusal is said in the confirmation, whose Remove may be pressed again.
   A role another organizer took meanwhile is taken all the same: the server answers "They no longer have a role on this market.", a 404, and the dialog reads it as done, closing the confirmation and re-reading the list without them (T181).
   A role another organizer changed meanwhile, or the requester's own, is not taken, nor one whose market moved to another phase: the server answers with [the market write's one sentence](../../implementation/modules/market-write.md#what-it-answers), which the confirmation says, and the list behind it is re-read (T274).
   Each row's Remove is the destructive intent at secondary weight, red ink on white, not a filled red button on every row ([the design language](../../design-system.md#the-primitive-layer)).
5. Under the list, when a row comes through the organization: "Organization admins and members are managed in Manage organization.", "Manage organization" a link to `/organizations?manage=<id>`, which opens that organization's dialog, for a reader who belongs to it, and plain words for anyone else.
6. "Add user", for an Admin or the owner only (bug 37): the email, the role, "Add", and "Cancel" on the same row, or on a phone the email above the rest.
   An address that already has a role on the market is refused beneath the row, brought into view as the row may be the last in the body, pointing to that person's own row: adding once overwrote any role, the owner's too, around the guards a role change keeps (T15).
   When the roles the add stood on changed meanwhile (the requester's own, or the person's, given by another organizer), or the market moved to another phase, the add is refused with [the market write's one sentence](../../implementation/modules/market-write.md#what-it-answers) beneath the row, the address kept, and the list is re-read (T274).
   On a list with a find field, or words in it, the field then takes the added address, so their row is the one shown and their role reads at once; clearing the field shows the whole list.
7. A refused change of role closes the confirmation, re-reads the list and is said beneath that person's row, which states the role the server holds, since someone else may have moved it first.
   When that moved the row past those shown, the find field takes their address, so the refusal is still read.
   When someone else removed them first, the row is gone and the words stand at the foot of the list, after their address; adding them back brings the row back without the words.

The organization line says "Belongs to <organization>. Its admins run it; its members can view it."
Covered by:

- `*-sweep.spec.ts`, the sweeps' states "the manage-market dialog, an organization's people", "the manage-market dialog, removing a market role" and "the manage-market dialog, changing a market role"
- `access-control.spec.ts`
- [`an-address-breaks-only-before-its-at.spec.ts`](../../../front-end/e2e/an-address-breaks-only-before-its-at.spec.ts) (its rows)
- [`changing-a-role-asks-first.spec.ts`](../../../front-end/e2e/changing-a-role-asks-first.spec.ts) (the confirmation's words, its closes, one write on confirm and where focus goes, a table whose owner moved a row, a refusal, one after someone else moved or removed them first, the arrow keys, and Viewer to Admin in sight at 1280 and 390)
- [`everyone-with-access.spec.ts`](../../../front-end/e2e/everyone-with-access.spec.ts) (the walk's case, and at 390 nothing overflowing and each Remove a 44px target, on one edge)
- `manageMarketMeetsAChangedMarket.test.ts` (a role's add, change and take refused over a changed market)
- [`people-at-scale-market.spec.ts`](../../../front-end/e2e/people-at-scale-market.spec.ts) (the list at 154 people: a page at a time, finding one person, the place kept, someone just added; on a phone at 390 and 320)
- [`removing-someone-asks-first.spec.ts`](../../../front-end/e2e/removing-someone-asks-first.spec.ts) (the confirmation's words, Cancel, Escape, confirming and where focus goes, someone removed in another window included, at 1440 and 390)
- `the-manage-market-dialog-holds-together.spec.ts`
- `tier2.spec.ts` ("add user, change role, and remove user from market")

## L3a. Set who may do what

**Status:** Works (E39/F01/S04; read from the code and driven by `the-permissions-section.spec.ts`).

1. "Permissions", after "Users with access", is a heading, the line "Who may do what on this market." with "Every row is at its built-in default." or how many rows differ from the built-in defaults, and "Show", which opens the rows in a dialog of their own over Manage market, so reading them never grows it (T217).
2. The dialog, "Permissions", is at most 80% of the window at a desk, and the window less the gutter on a phone or in a short window; its title stays as its rows and changes scroll, and it lists every row of [the market's table](../../implementation/modules/market-actions.md#a-markets-own-rows) under its group, in the table's order: its label, where its role came from ("Built-in default", "Copied from the organization" for a row its organization's default set ([B8](organizations.md#b8-set-the-default-permissions-for-new-markets)), or "Changed on this market by <address>, <when>", from the row's newest change), and its role as "Viewer and above", "Editor and above", "Admin and above" or "Owner only".
   A group's title sits nearer its own rows than the group above, at a desk and on a phone (T211), and Manage organization's default permissions read the same.
3. For the owner each row that is not fixed is a dropdown of those four, named by the row's label, whose arrow keys open its list rather than step it, since each step would be a change to confirm; a fixed row ("Read the market...", "Give and take Admin roles", "Hand the market on", "Delete the market", "Change this table") states its role with "Always" and no control.
   "Give and take Editor and Viewer roles" says beside it that at "Viewer and above" any Viewer can make themself an Editor, since one row asks for both the role given and the role taken.
4. Choosing a role asks first, in words naming who may after it and who loses or gains it ("Let only Admins and the owner check vendors in at this market?", "Editors lose this."), and for that row lowered to Viewer adds "A Viewer could then make themself an Editor."; "Change" saves that row alone, Cancel puts the dropdown back, and a refusal is said in the confirmation.
   A change, a reset or a copy over a table that changed since Manage market read it, or a market that moved to another phase, is refused with [the market write's one sentence](../../implementation/modules/market-write.md#what-it-answers) in its confirmation, and the market is read again, so the rows behind it are the ones stored (T274).
   The confirmation then asks about the row as it now stands, its words and Cancel following the role the row holds, and a reset lists the rows it would return now; one the re-read left with nothing to change (the row already at the role chosen, or every row at its default) closes, and the sentence stands in Permissions until the next change is asked for.
5. "Reset to built-in defaults" lists each row it returns, from its role now to its default, opens on Cancel since it throws away every row the owner set, and resets them all in one write, recorded as one change; it is disabled while every row is at its default, so after a reset focus goes to the dialog's first control rather than back to it.
6. "Copy the organization's defaults again", beside it for the owner of a market that belongs to an organization, asks first ("Copy the organization's defaults again?", saying every row takes the organization's default as it is now, a row it does not set returns to its built-in default, and rows changed on this market are replaced), opens on Cancel, and copies them in one write, recorded as one change; each copied row then says "Copied from the organization".
7. "Changes" lists the market's history narrowed to the table, newest first, in a box of bounded height that shows 25 more as its end scrolls into view, as the market's History does: the row, its role before and after ("Editor to Admin"), or "Reset to built-in defaults" or "Copied the organization's defaults" with each row it changed, and who made it and when, by their address, as "Users with access" names people.
   It is the market's history, so someone the row "Read the market's history" refuses (an owner may raise it above the roles that see this section) has no "Changes", and a row changed on this market says only "Changed on this market".
8. For anyone but the owner the dialog is read-only and says "Only the market's owner changes these."; on an archived market, the owner included, it says the archived words instead.
   A reader gets no foot, and with no control in the dialog focus lands on its body at each opening, so the arrow keys scroll the rows; the changes are read afresh each time, so their box comes after focus has landed.
9. Reset and Copy are pinned at the dialog's foot for the owner, in reach from any row, and a change, a reset or a copy asks first over the dialog: Cancel, Escape and the backdrop close only the confirmation, and a confirm writes once and leaves the dialog open with the table and the changes read again.
   Closing the dialog, whichever way, gives focus back to "Show", with Manage market as it was.

Beneath Permissions, "History", closed until opened, lists every change on the market, newest first, for whoever may read the market's history: [L6](reading-the-markets-history.md#l6-read-the-markets-history).

A change reaches every screen at its next read of the market: the dialog and the section's line show the table the write answers, and the market open in the store, when it is this one, is re-read, as a rename re-reads it.
The section and its dialog are [`MarketPermissions.vue`](../../../front-end/src/components/MarketPermissions.vue), its rows and its changes the shared [`PermissionRows.vue`](../../../front-end/src/components/PermissionRows.vue) and [`PermissionChanges.vue`](../../../front-end/src/components/PermissionChanges.vue) that Manage organization's default permissions show too, the dialog and its three confirmations teleported beside Manage market as a dialog opened from a dialog is ([dialogs](../../implementation/conventions/dialogs.md)); the words are [`front-end/src/utils/permissionTable.ts`](../../../front-end/src/utils/permissionTable.ts)'s, and the server keeps the table and its changes structured.
Covered by:

- `*-sweep.spec.ts`, which walk the dialog open
- `every-control-is-named.spec.ts`, which walks the dialog open
- `manageIsOfferedToWhoeverReads.test.ts`
- `manageMarketMeetsAChangedMarket.test.ts` (a row's change, Reset and Copy refused over a changed market)
- `marketPermissions.test.ts`
- `permissionTable.test.ts`
- `the-markets-history.spec.ts` for a long record of its changes, in their box
- `the-organizations-default.spec.ts` for the copy again
- [`the-permissions-section.spec.ts`](../../../front-end/e2e/the-permissions-section.spec.ts) (a group's title nearer its rows than the group above, at 1280 and 390; the dialog's height, its confirmations, focus and Manage market's scroll on closing, and a reader's keys)

## L4. Rename a market

**Status:** Works (walked live in Draft).
"Rename market", with the name and "Save", in Draft only; afterwards "This market's public web address comes from its name, and it has already been shared, so its name can no longer change.", and an archived market says it is archived.
The new name is stored without the spaces at its ends, and holds the rule a new market's does ([D6](creating-a-market.md#d6-a-name-of-at-most-100-characters-on-one-line)): the field takes at most 100 characters, and the server's refusal ("A market's name can be at most 100 characters.", "A market's name must be on one line.", "A market needs a name.") shows under it.
A rename that lands after the market left draft is refused with [the market write's one sentence](../../implementation/modules/market-write.md#what-it-answers) under the name, and the market is read again, so the field gives way to why the name can no longer change (T274).
Covered by:

- `a-market-name-fits-one-line.spec.ts`
- `manageMarketMeetsAChangedMarket.test.ts` (a rename refused over a market that left draft)
- `public-address.spec.ts`

## L4a. Hand the market on

**Status:** Works (T283; driven by `handing-a-market-on.spec.ts` at 1440 and on a phone at 390).

1. "Hand this market on", after "Rename market" and before "Delete market", is the owner's alone, the fixed row "Hand the market on" ([what each role may do](../rules/what-each-role-may-do.md)), in every phase, archived included, since an archived market still needs someone who can delete it.
   It says "Make someone with access its Owner. You stay on it as an Admin." and offers "Hand on"; with nobody but the owner under "Users with access" it says "Nobody else has access to this market yet. Add someone under Users with access first." and offers nothing.
2. "Hand on" opens "Hand <market> on", a destructive dialog that opens on Cancel, since the owner cannot take it back themselves ([`HandOnMarketDialog.vue`](../../../front-end/src/components/HandOnMarketDialog.vue)).
   Its picker, "New owner", offers everyone under "Users with access" but the owner, each address with the role that counts beside it ("Admin", "Viewer, through <organization>"), found by any part of the address, at most 50 drawn at a time.
3. Once someone is chosen it says "<address> becomes its Owner: only they can delete it, give and take Admin roles and change who may do what. You stay on it as an Admin, and cannot take it back yourself."; "Hand on" waits for a choice, and nothing closes the dialog while the request is in flight.
4. "Hand on" makes that person the Owner and the owner an Admin in one write (`POST /markets/:id/hand-on`), and [the market's history](../../implementation/data/history.md) records it: "<owner> handed the market on to <address>, and stays on it as an Admin".
   The dialog closes, the market is re-read, so the section and "Delete market" go and "Users with access" shows both new roles, the market open in the store is re-read when it is this one, and focus goes to "Users with access".
5. A refusal stays in the dialog with the choice: someone who no longer has access is refused "You can hand this market only to someone who has access to it.", and a hand-on over a market whose owner or the person chosen changed role meanwhile, a second hand-on from another tab among them, is refused with [the market write's one sentence](../../implementation/modules/market-write.md#what-it-answers), the market behind it re-read.

The new Owner, signing in, finds "Delete market" and "Hand this market on" theirs.
Covered by:

- [`handing-a-market-on.spec.ts`](../../../front-end/e2e/handing-a-market-on.spec.ts) (the section, the dialog's words and picker, the write, where focus goes, the History's sentence and the new Owner's Manage market, at 1440 and on a phone at 390)
- `handingAMarketOn.test.ts`

## L5. Delete a market

**Status:** Works (walked live; what it names read from the code as of bug 43's fix and E30/F01/S03).
Owner only, in any phase: "Delete market" opens "Delete <market>?", which names what goes ("This deletes the market with its applications, its assignments, its check-in records and the record of who changed what. It cannot be undone."), adds "Its vendor page will stop working for anyone who has the link." while its vendor page answers (a form market after draft, a Google Form market once its results are published or it reached its market days), and opens on Cancel (bug 43).
Everything the market kept beside itself is deleted with it (bug 47).
Covered by:

- `market-records-go-with-it.spec.ts`
- `the-manage-market-dialog-holds-together.spec.ts`
- `tier2.spec.ts`

## The rules it obeys

- [An archived market is read-only](../rules/an-archived-market-is-read-only.md): roles, handing it on and deletion are not changes.
- [An archived market that ran stays a record](../rules/an-archived-market-that-ran-stays-a-record.md).
- [What each role may do](../rules/what-each-role-may-do.md).
- [When an organization may be deleted](../rules/when-an-organization-may-be-deleted.md): the other way a market goes.

What deleting takes with it is [market deletion](../../implementation/modules/market-deletion.md).
Its gaps worth a spec are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
