---
layer: business
kind: flow
verified: 2026-10-21
sources:
  - E26/F06/S02
  - E26/F08/S01
  - bug/9
  - bug/37
---

# Organizations

**Who:** an organizer; what each can change depends on their role in the organization.
**Where they start:** the dashboard's "Organizations", the navigation menu, or `/organizations`.
**Serves:** [A request can only do what its session may](../intents/a-request-can-only-do-what-its-session-may.md).

A market must belong to an organization, and its organization never changes after creation.
An organization's people are its Owner, its Admins and its Members; only the owner renames it or adds an admin, the owner or an admin adds a member, and the owner removes anyone but themselves while an admin removes only members ([the organization document, and roles](../../implementation/data/organization-document.md#the-organization)).
Being in an organization in any role gives Viewer, and only Viewer, on its markets ([what each role may do](../rules/what-each-role-may-do.md)).

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
4. Sign in as that person: every market of the organization is visible to them as a Viewer.

Branches: an email with no account, someone already in the organization, an Admin trying Owner-only actions.
Covered by: `tier2.spec.ts`, `dialog-idiom.spec.ts`, `access-control.spec.ts`.

## B3. Remove a person

**Status:** Works (walked live).
"Remove" beside them, with no confirmation; they lose Viewer access to the organization's markets unless the market gives them a role of its own.
Covered by: `access-control.spec.ts` ("org membership changes").

## B4. Rename an organization

**Status:** Works (walked live).
Manage, "Rename organization", edit, "Save".
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

Applications Open through Market Days.
**Status:** Works (walked live).
Refused, naming each blocking market and its phase: "Archive or delete them first, then come back."

## B6. Transfer ownership

**Status:** No screen (`POST /organizations/<id>/transfer` exists; no screen offers it).

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
