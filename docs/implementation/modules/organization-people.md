---
layer: implementation
kind: module
describes:
  - back-end/organization_people.py
  - back-end/tests/test_one_writer_holds_each_place_it_judged.py
  - back-end/tests/test_an_organizations_people_stay_one_map.py
  - back-end/tests/real_mongo/test_an_organizations_people_on_the_server.py
  - back-end/tests/test_the_shared_organizations_fake.py
  - back-end/tests/test_every_module_imports_first.py
  - front-end/src/views/ManageOrgOverlay.vue
  - front-end/src/utils/api.ts#isOrganizationChanged
  - front-end/src/__tests__/aChangeThatMetAnotherInAnOrganization.test.ts
  - front-end/src/__tests__/changingAPlaceAsksFirst.test.ts
  - front-end/e2e/an-organizations-people-change-place.spec.ts
verified: 2026-11-13
sources:
  - T283
  - T315
---

# The organization's people

[`back-end/organization_people.py`](../../../back-end/organization_people.py) is the one writer of an organization's people, the map `people` from user id to `owner`, `admin` or `member` ([the organization document](../data/organization-document.md#one-map-of-people), [ADR 0025](../../adr/0025-an-organizations-people-are-one-map.md)).
It also builds the one filter that finds the organizations a person is in, `of_person`, and the one spelling of a person's path in the map, `people_key`.

## Its interface

- `add_admin(org_id, email, requester)`, `add_member(org_id, email, requester)` and `remove(org_id, user_id, requester)`: each loads the organization and the account asking, judges the change on the organization as read and writes it in one conditional write, then writes the account's own copy of its organizations and records the change in the organization's history.
  `api/organizations.py`'s `add_org_admin`, `add_org_member` and `remove_org_user` call them and nothing more, so the routes keep their names.
- `change_place(org_id, user_id, place, requester)`: the owner makes an admin a member or a member an admin, `place` being the request's `"admin"` or `"member"` and anything else refused before the organization is read, 400 "A place is admin or member.".
  `api/organizations.py`'s `change_org_place` calls it, for `PUT /organizations/<org_id>/users/<user_id>`, which answers `{"message": "Place changed"}`.
  The account's copy is left alone, since the person was in the organization before and is after.
- `transfer(org_id, requester, new_owner_email)`: the owner hands the organization on to one of its admins or members, and stays on it as an admin.
  `api/organizations.py`'s `transfer_org_ownership` calls it, for `POST /organizations/<org_id>/transfer`, which answers `{"message": "Ownership transferred successfully"}`.
  Anyone but the owner is refused first, 403 "Only current owner can transfer ownership", then an address with no account, 400 "New owner user not found".
  The new owner's account gains the organization in its copy, and the history records `transfer-organization` with the owner's address before and after, as it always has.
- `forget(user_id)`: an account's deletion takes its place in every organization it was an admin or a member of, by two `update_many`, one over the organizations with a map (their key, `$in` admin or member, unset and pulled from both lists) and one over those stored before it (pulled from both lists).
  An owner is matched by neither: `delete_user` refuses an owner before it deletes the account.
  That leaves one window, accepted: `delete_user` reads that the account owns no organization and only then deletes it, so a transfer to that account landing in between leaves an organization owned by an account that is gone, which `forget` does not match and nobody can hand on.
  It needs the person deleting their account and someone handing them an organization in the same moment, no screen deletes an account, and closing it needs a transaction across the users and organizations collections.
  A market has the same window: `delete_user` reads that the account owns no market and only then deletes it, so a market the same person creates in another tab in between, or one another market's owner hands on to them then ([handing a market on](market-actions.md#hand-the-market-on-hand-on-market)), is left owned by an account that is gone; it is accepted for the same reasons, a transaction across the users and markets collections closing it.
- `next_people(people, event, requester_id, target_id)`: the map a change leaves, or the client error it answers, with no database; the writer and the tests both call it.
- `OrganizationChanged`, a `ConflictError`: 409, body `{"error": ORGANIZATION_CHANGED, "code": "organization_changed"}`.

## The table

**`AUTHORITY` says who may ask for each change, by their place as read, and is checked first**: "Add admin" is the owner's ("Only organization owner can add admins"), "Add member" and "Remove" the owner's or an admin's ("Only organization owner or admin can add members", "... can remove users"), a place change the owner's ("Only the organization's owner can change someone's place in it."), and a transfer the owner's ("Only current owner can transfer ownership").
**`TABLE` says what each change does to the target's place as read**:

| Target's place | Add admin                                             | Add member                                            | Change place to admin | Change place to member | Remove                                                            | Transfer to them                                                  | Forget        |
| -------------- | ----------------------------------------------------- | ----------------------------------------------------- | --------------------- | ---------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------- |
| none           | admin                                                 | member                                                | 404 (as Remove)       | 404 (as Remove)        | 404 "They are no longer in this organization."                    | 400 "Hand the organization only to one of its admins or members." | nothing       |
| member         | admin                                                 | 400 "They are already a member of this organization." | admin                 | member, nothing done   | none                                                              | owner, and the giver admin                                        | none          |
| admin          | 400 "They are already an admin of this organization." | 400 "Admin cannot be added as member"                 | admin, nothing done   | member                 | none, the owner's alone (403 "Only owner can remove admins")      | owner, and the giver admin                                        | none          |
| owner          | 400 "Owner cannot be added as admin"                  | 400 "Owner cannot be added as member"                 | 400 (below)           | 400 (below)            | 400 "Cannot remove organization owner. Transfer ownership first." | 400 "They already own this organization"                          | never reached |

"Add admin" of a member makes them an admin, as Manage organization's "Add admin" field always has, recorded as the place changed.
A place set to the place held answers 200 and writes and records nothing; the owner's place is refused, 400 "The owner's place changes only when the organization is handed on.".
A person changing place keeps their position in the map's order, the transfer's giver and new owner alike; someone added joins its end.
A place change is recorded as the admins' `role_changed`, with the place before and after.

## Every write holds what it judged

**On an organization with a map, the write's filter holds the requester's and the target's keys at their places as read**, `{"$exists": false}` where the target had none, and its update moves the target's one key: `$set` or `$unset` of `people.<id>`, with `$addToSet` to the list of the place after and `$pull` from the list of the place before, or from both when they leave.
**On an organization stored before the map, the filter holds `people` absent and `owner`, `admins` and `members` equal to what was read**, and the update sets `people` whole, the fold with the change applied, beside the three lists as its mirror, so the first change to such an organization folds it, the owner winning and every duplicate dropped.
That filter and update are `folding_write(org, people)`, which the migration that folds every organization stored before the map, [`migrate_organization_people.py`](../../../back-end/migrations/migrate_organization_people.py), writes too ([the organization document](../data/organization-document.md#migrations)), so a change and the migration fold alike.
`reconciling_write(org, people)` is the migration's alone, for its `--reconcile` after a roll forward over a rollback past the map's release: held on the map as read, whole and in its key order, and the three lists as read, it sets the map rebuilt from the lists beside them as its mirror; no change to a person's place writes it.
Either way the lists stay an exact mirror of the map, for a rollback to the release before the map, and no write sets the same path twice.
**A change that changes nothing writes and records nothing.**
A user id reaches a path only from a stored account or the stored map: `remove`'s and `change_place`'s id comes from the request's address, and is looked up in the map as read before any path is built, so one the map does not hold, dotted or not, is a 404.

**Handing the organization on is one such write, filtered on the giver being owner** and the new owner at their place as read, so no cut and no read finds the organization with two owners, none, or an owner in a list.
Its update sets both keys and `owner`; from a member it pulls them from `members` and adds the giver to `admins`; from an admin it sets `admins` to the list as read with the giver where the new owner stood, one path for both, and so also holds `admins` as read, lest an admin added meanwhile be dropped from the list while the map keeps them.
On an organization stored before the map it is the fold's write, as for every change.
It was four unconditional writes: cut between them, an organization stored its owner in its own `admins` and did not parse, or the person it was handed to had no place in it at all.

## A write that met a change

**A write that matched nothing reads the organization once more to answer**: gone, 404 "Organization not found"; a removal whose target is now gone, 404 "They are no longer in this organization.", which Manage organization reads as done; anything else, `OrganizationChanged`, 409, "This organization changed while you were working on it, so your change was not saved. Check its people as they are now, then make your change again."
Nothing is retried on the server: the person decides again on what is true.
So two transfers judged on one read land once, a transfer to someone removed meanwhile is the 409, and an "Add member" judged before the owner handed the organization to that same person is refused, where it used to land the new owner in `members` and leave an organization that did not parse.
A place change of someone removed meanwhile is that 409 too, since only a removal reads the person gone as done.
**Manage organization** ([`ManageOrgOverlay.vue`](../../../front-end/src/views/ManageOrgOverlay.vue)) tells the 409 apart by its code (`isOrganizationChanged` in [`api.ts`](../../../front-end/src/utils/api.ts)), shows its sentence where the control's refusal shows, under the add form or in the Remove or place-change confirmation, which stays open, and reads the organization again behind it, the list behind and the History with it.

**The account's copy is written after the organization's write, best effort**, `$addToSet` on an add and on a transfer's new owner and `$pull` on a removal, and nothing on a place change, since no check reads it ([users and email](../data/users-and-email.md)).

## Make member and Make admin

**Manage organization gives its owner "Make member" on each admin's row and "Make admin" on each member's**, secondary buttons before Remove, each naming the person in a visually hidden span, as Remove does.
Each carries `data-dialog-not-first`, so Manage organization still opens on "Add admin", never on the first admin's row ([dialogs](../conventions/dialogs.md)).
Each opens a confirmation in `AppDialog`, not destructive, whose words `organizationPlaceChange` in [`organizations.ts`](../../../front-end/src/utils/organizations.ts) gives: "Make <email> a member?", "They will read every market of <organization> instead of running it, unless a market gives them a role of its own.", confirmed by "Make member"; or "Make <email> an admin?", "They will run every market of <organization> as its Admin.", confirmed by "Make admin".
`AppDialog` draws its title, as every dialog's, through `EmailAddress`, so a long address breaks only before its "@" or a dot ([dialogs](../conventions/dialogs.md)), and so does the Remove confirmation's.
The flow is [B3a in organizations](../../business/flows/organizations.md#b3a-make-an-admin-a-member-or-a-member-an-admin).
Confirmed, the organization is read again, the confirmation closes, and focus goes to the list the person now stands in, a `tabindex="-1"` group named by its heading, as after a Remove.
A 404, someone removed meanwhile, is read as done, with focus on the list their row left; every other refusal stays in the confirmation, the 409 with the organization read again behind it.

## Sharp edges

**It imports `history` inside `_record_role`**: `history` reads `api.market_actions`, which reads `api.permissions`, which reads `of_person` here, so a module-level import is a cycle that stops the server at boot while the suite, importing in conftest's order, passes.
[`test_every_module_imports_first.py`](../../../back-end/tests/test_every_module_imports_first.py) imports every back-end module first in a fresh interpreter, and names any that cannot be.

**The organization tests write through one fake**: `FakeOrganizations` in `back-end/tests/conftest.py` filters with `mongo_matches` and writes with `mongo_update`, as the server does, with a hook that runs another request between a read and the next write and a cut at a chosen write; `install_organizations` makes it the collection of both `api/organizations.py` and this module.
[`test_the_shared_organizations_fake.py`](../../../back-end/tests/test_the_shared_organizations_fake.py) runs `tests/mongo_cases.py`'s update table through it, and that table and the filter table carry every shape this module writes and filters by, checked on a server by [the real-MongoDB suite](../testing/real-mongo-suite.md).

## How it is tested

[`test_one_writer_holds_each_place_it_judged.py`](../../../back-end/tests/test_one_writer_holds_each_place_it_judged.py): every cell of the table through `next_people`, every authority and refusal through the routes, each write's filter and update on both shapes with the lists a mirror after, the account's copy and the history, and each way a write meets a change, the add judged before a transfer among them; the transfer's cells, authority and refusals, and its write to a member and to an admin.
[`test_an_organizations_people_stay_one_map.py`](../../../back-end/tests/test_an_organizations_people_stay_one_map.py): the planner's two transfer-cut probes, asserting the organization reads as it was or as handed on; a cut at each write a transfer makes (the organization's, the account copy's, the history's), from a member and from an admin, on both shapes, leaving one owner; and the property, 50 seeds of 40 changes each (add admin, add member, change place, remove, transfer) by random requesters on random targets among six accounts, a third with a second change landing between the first's read and its write, asserting after each one owner, every value a place, the lists an exact mirror, the document parsing, and, for a change nothing met, the map `next_people` answers, in its order.
[`test_an_organizations_people_on_the_server.py`](../../../back-end/tests/real_mongo/test_an_organizations_people_on_the_server.py), in [the real-MongoDB suite](../testing/real-mongo-suite.md): the races on a server, on both shapes.
[`aChangeThatMetAnotherInAnOrganization.test.ts`](../../../front-end/src/__tests__/aChangeThatMetAnotherInAnOrganization.test.ts): the 409's sentence under each add form and in the Remove confirmation, with the re-read behind it, and no re-read for any other refusal.
[`changingAPlaceAsksFirst.test.ts`](../../../front-end/src/__tests__/changingAPlaceAsksFirst.test.ts): the two buttons for the owner alone, the confirmations' words, Cancel and Escape, the request, the re-read and where focus goes, the 404 read as done, the 409 and any other refusal in the confirmation, and one request however often the confirm is pressed.
[`an-organizations-people-change-place.spec.ts`](../../../front-end/e2e/an-organizations-people-change-place.spec.ts): the owner makes an admin a member and back on the stack, each asked first, with the buttons' names, the rows, the focus, the History and a reload, at a desk and on a phone.

## Why

[Organization and roles](../../business/concepts/organization-and-roles.md) and [what each role may do](../../business/rules/what-each-role-may-do.md): a person has one place in an organization, and an organization one owner, at every moment.
