---
layer: business
kind: flow
verified: 2026-10-30
sources:
  - E26/F06/S02
  - E26/F08/S01
  - bug/9
  - bug/37
  - T15
  - decision/2026-10-20
  - E40/F02/S01
---

# Organizations

**Who:** an organizer; what each can change depends on their role in the organization.
**Where they start:** the dashboard's "Organizations", the navigation menu, or `/organizations`.
**Serves:** [A request can only do what its session may](../intents/a-request-can-only-do-what-its-session-may.md).

A market must belong to an organization, and its organization never changes after creation.
An organization's people are its Owner, its Admins and its Members; only the owner renames it or adds an admin, the owner or an admin adds a member, and the owner removes anyone but themselves while an admin removes only members ([the organization document, and roles](../../implementation/data/organization-document.md#the-organization)).
Its owner and admins run every market it holds as the market's Admin does, and a member reads them; a role a market gives someone counts beside that, and the higher one is held ([what each role may do](../rules/what-each-role-may-do.md)).

## B1. Create an organization

**Status:** Works (walked live).
**Task:** "Set up an organization for your market team."

1. Dashboard, "Organizations" (or `/organizations`).
2. "New organization", name it, "Create".
3. Expect a card with the name and your role (Owner).

A person with no organization is told on the dashboard and in the create-market dialog to make one here first ([D4](creating-a-market.md#d4-create-a-market-with-no-organization-yet)).
Covered by: `tier2.spec.ts` ("Organization CRUD").

## B2. Add an admin or a member

**Status:** Works (walked live); a Viewer's market pages draw no control they cannot use (bug 37).

1. On an organization card, "Manage".
2. Under Admins, "Add admin", enter an existing account's email, "Add"; under Members, "Add member" likewise.
3. Expect the person listed and the dialog still open (closing is not saving).
4. Sign in as that person: an admin runs every market of the organization as its Admin (Manage on each market's card, the rail's phase moves, the seats on Result), and a member sees every one as a Viewer.

Branches: an email with no account, someone already in the organization, an Admin trying Owner-only actions.
Covered by: `tier2.spec.ts`, `dialog-idiom.spec.ts`, `access-control.spec.ts`, `screens-match-roles.spec.ts` ("an organization admin with no role on the market").

## B3. Remove a person

**Status:** Works (walked live).
"Remove" beside them, with no confirmation; they lose what the organization gave them on its markets (Admin for an admin, Viewer for a member) and keep any role a market gives them of its own.
Covered by: `access-control.spec.ts` ("org membership changes").

## B4. Rename an organization

**Status:** Works (walked live).
Manage, "Rename organization", edit, "Save"; the owner's alone, so an admin's dialog has no such section.
Covered by: `tier2.spec.ts`.

## B5. Delete an organization

Manage, "Delete organization" opens a preview of what would be destroyed; confirm with "Delete it all".
A deletion record is written before anything is destroyed.
Covered by: `org-deletion.spec.ts`.
The rule it obeys is [when an organization may be deleted](../rules/when-an-organization-may-be-deleted.md).

### B5a. It holds no markets

**Status:** Works (walked live).
"This organization holds no markets, so nothing else goes with it."

### B5b. It holds only drafts and archived markets

**Status:** Works (walked live with a draft; the archived case read from code).
Each market is listed with its phase, whether it ran and how many placements it holds; an archived market that ran also names the check-in page that stops working ("/<slug>/check-in will stop working"), the record it kept up ([L1](ending-and-managing-a-market.md#l1-archive-after-market-days), bug 9).

### B5c. It holds a market mid-lifecycle

Applications (Review) through Market Days.
**Status:** Works (walked live).
Refused, naming each blocking market and its phase: "Archive or delete them first, then come back."

## B6. Transfer ownership

**Status:** No screen (`POST /organizations/<id>/transfer` exists; no screen offers it).

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).

## B7. Read the organization's history

**Status:** Works (E2E-walked by `the-organizations-history.spec.ts`; not yet walked live).
**Who:** the organization's owner, its admins and its members; anyone else is refused.

1. On the organization's card, "Manage"; every one of its people has it, and a member's dialog holds only the owner and the History.
2. "History", a heading with a chevron, closed until opened, as [Manage market's](reading-the-markets-history.md#l6-read-the-markets-history) is; opening it reads the newest 10 changes, newest first, and "Load more" adds the next 10.
3. Each change is one sentence and its time, worded as the market's history words them: "e2e@example.com renamed the organization from "Ember Markets" to "Ember Fairs"", "e2e@example.com gave priya@example.com the Admin role", "e2e@example.com changed priya@example.com from Member to Admin", "e2e@example.com took the Member role from priya@example.com", "e2e@example.com handed the organization to priya@example.com", "e2e@example.com created the market "Winter Fair"", "e2e@example.com deleted the market "Winter Fair"", "e2e@example.com added the floorplan template "Main hall"" (and "changed", "removed"), "e2e@example.com moved the floorplan template "Main hall" out of the organization" (and "into").
4. "Before and after" opens a table of what each change set, as it was and as it is.
5. A change made in the dialog while the History is open (a person added or removed, a rename) shows at its top as it lands, without reopening the dialog.

With nothing yet it says "Nothing has changed on this organization yet."
What is recorded, and why a member may read it: [the organization document](../../implementation/data/organization-document.md#the-organizations-history).
Covered by: `the-organizations-history.spec.ts`, and `organizationHistory.test.ts` for the words, the paging and a member's dialog.
