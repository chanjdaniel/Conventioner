---
layer: implementation
kind: module
describes:
  - back-end/organization_people.py
  - back-end/tests/test_one_writer_holds_each_place_it_judged.py
  - back-end/tests/test_the_shared_organizations_fake.py
  - back-end/tests/test_every_module_imports_first.py
  - front-end/src/views/ManageOrgOverlay.vue
  - front-end/src/utils/api.ts#isOrganizationChanged
  - front-end/src/__tests__/aChangeThatMetAnotherInAnOrganization.test.ts
verified: 2026-11-11
sources:
  - T283
---

# The organization's people

[`back-end/organization_people.py`](../../../back-end/organization_people.py) is the one writer of an organization's people, the map `people` from user id to `owner`, `admin` or `member` ([the organization document](../data/organization-document.md#one-map-of-people), [ADR 0025](../../adr/0025-an-organizations-people-are-one-map.md)).
It also builds the one filter that finds the organizations a person is in, `of_person`, and the one spelling of a person's path in the map, `people_key`.

## Its interface

- `add_admin(org_id, email, requester)`, `add_member(org_id, email, requester)` and `remove(org_id, user_id, requester)`: each loads the organization and the account asking, judges the change on the organization as read and writes it in one conditional write, then writes the account's own copy of its organizations and records the change in the organization's history.
  `api/organizations.py`'s `add_org_admin`, `add_org_member` and `remove_org_user` call them and nothing more, so the routes keep their names.
- `forget(user_id)`: an account's deletion takes its place in every organization it was an admin or a member of, by two `update_many`, one over the organizations with a map (their key, `$in` admin or member, unset and pulled from both lists) and one over those stored before it (pulled from both lists).
  An owner is matched by neither: `delete_user` refuses an owner before it deletes the account.
- `next_people(people, event, requester_id, target_id)`: the map a change leaves, or the client error it answers, with no database; the writer and the tests both call it.
- `OrganizationChanged`, a `ConflictError`: 409, body `{"error": ORGANIZATION_CHANGED, "code": "organization_changed"}`.

## The table

**`AUTHORITY` says who may ask for each change, by their place as read, and is checked first**: "Add admin" is the owner's ("Only organization owner can add admins"), "Add member" and "Remove" the owner's or an admin's ("Only organization owner or admin can add members", "... can remove users").
**`TABLE` says what each change does to the target's place as read**:

| Target's place | Add admin                                             | Add member                                            | Remove                                                            | Forget        |
| -------------- | ----------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- | ------------- |
| none           | admin                                                 | member                                                | 404 "They are no longer in this organization."                    | nothing       |
| member         | admin                                                 | 400 "They are already a member of this organization." | none                                                              | none          |
| admin          | 400 "They are already an admin of this organization." | 400 "Admin cannot be added as member"                 | none, the owner's alone (403 "Only owner can remove admins")      | none          |
| owner          | 400 "Owner cannot be added as admin"                  | 400 "Owner cannot be added as member"                 | 400 "Cannot remove organization owner. Transfer ownership first." | never reached |

"Add admin" of a member makes them an admin, as Manage organization's "Add admin" field always has, recorded as the place changed.
A person changing place keeps their position in the map's order; someone added joins its end.
The place change and the transfer join the table in T283's tickets 03 and 04.

## Every write holds what it judged

**On an organization with a map, the write's filter holds the requester's and the target's keys at their places as read**, `{"$exists": false}` where the target had none, and its update moves the target's one key: `$set` or `$unset` of `people.<id>`, with `$addToSet` to the list of the place after and `$pull` from the list of the place before, or from both when they leave.
**On an organization stored before the map, the filter holds `people` absent and `owner`, `admins` and `members` equal to what was read**, and the update sets `people` whole, the fold with the change applied, beside the three lists as its mirror, so the first change to such an organization folds it, the owner winning and every duplicate dropped.
Either way the lists stay an exact mirror of the map, for a rollback to the release before the map, and no write sets the same path twice.
**A change that changes nothing writes and records nothing.**
A user id reaches a path only from a stored account or the stored map: `remove`'s id comes from the request's address, and is looked up in the map as read before any path is built, so one the map does not hold, dotted or not, is a 404.

**The transfer is not yet the module's**: `transfer_org_ownership` still writes its lists and then, on an organization with a map, the two keys in a second write, until ticket 04 makes it one write here.

## A write that met a change

**A write that matched nothing reads the organization once more to answer**: gone, 404 "Organization not found"; a removal whose target is now gone, 404 "They are no longer in this organization.", which Manage organization reads as done; anything else, `OrganizationChanged`, 409, "This organization changed while you were working on it, so your change was not saved. Check its people as they are now, then make your change again."
Nothing is retried on the server: the person decides again on what is true.
So an "Add member" judged before the owner handed the organization to that same person is refused, where it used to land the new owner in `members` and leave an organization that did not parse.
**Manage organization** ([`ManageOrgOverlay.vue`](../../../front-end/src/views/ManageOrgOverlay.vue)) tells the 409 apart by its code (`isOrganizationChanged` in [`api.ts`](../../../front-end/src/utils/api.ts)), shows its sentence where the control's refusal shows, under the add form or in the Remove confirmation, which stays open, and reads the organization again behind it, the list behind and the History with it.

**The account's copy is written after the organization's write, best effort**, `$addToSet` on an add and `$pull` on a removal, since no check reads it ([users and email](../data/users-and-email.md)).

## Sharp edges

**It imports `history` inside `_record_role`**: `history` reads `api.market_actions`, which reads `api.permissions`, which reads `of_person` here, so a module-level import is a cycle that stops the server at boot while the suite, importing in conftest's order, passes.
[`test_every_module_imports_first.py`](../../../back-end/tests/test_every_module_imports_first.py) imports every back-end module first in a fresh interpreter, and names any that cannot be.

**The organization tests write through one fake**: `FakeOrganizations` in `back-end/tests/conftest.py` filters with `mongo_matches` and writes with `mongo_update`, as the server does, with a hook that runs another request between a read and the next write and a cut at a chosen write; `install_organizations` makes it the collection of both `api/organizations.py` and this module.
[`test_the_shared_organizations_fake.py`](../../../back-end/tests/test_the_shared_organizations_fake.py) runs `tests/mongo_cases.py`'s update table through it, and that table and the filter table carry every shape this module writes and filters by, checked on a server by [the real-MongoDB suite](../testing/real-mongo-suite.md).

## How it is tested

[`test_one_writer_holds_each_place_it_judged.py`](../../../back-end/tests/test_one_writer_holds_each_place_it_judged.py): every cell of the table through `next_people`, every authority and refusal through the routes, each write's filter and update on both shapes with the lists a mirror after, the account's copy and the history, and each way a write meets a change, the add judged before a transfer among them.
[`aChangeThatMetAnotherInAnOrganization.test.ts`](../../../front-end/src/__tests__/aChangeThatMetAnotherInAnOrganization.test.ts): the 409's sentence under each add form and in the Remove confirmation, with the re-read behind it, and no re-read for any other refusal.

## Why

[Organization and roles](../../business/concepts/organization-and-roles.md) and [what each role may do](../../business/rules/what-each-role-may-do.md): a person has one place in an organization, and an organization one owner, at every moment.
