---
layer: implementation
kind: adr
describes:
  - back-end/datatypes.py#Organization
  - back-end/datatypes.py#people_from_lists
  - back-end/datatypes.py#organization_people_of
  - back-end/organization_people.py
verified: 2026-11-11
sources:
  - T277
  - T283
status: accepted
---

# An organization's people are one map

The node it constrains: [the organization document, and roles](../implementation/data/organization-document.md#one-map-of-people).
The glossary concept: [Organization and roles](../business/concepts/organization-and-roles.md).

## Context

An organization kept its people in three fields, `owner`, `admins` and `members`, and a person's place was whichever list they turned up in.
Nothing stopped a person standing in two of them, and the model refused an organization whose owner was also in `admins` or `members`.
When it refused, the market read logged the failure and treated the organization as absent, so every admin and member of it lost their role on every market it held, with no message to anyone and nothing that prompted a repair.
T277's research (section 4.3) reproduced three ways into that state: a transfer of ownership cut between its writes or read between them, and an "Add member" judged before a transfer to the same person.
A market's people were already one map, `roles`, from user id to role, with exactly one `owner`, and that shape has never let a person hold two roles on one market.

## Decision

An organization's people are one map, `people`, from user id to `owner`, `admin` or `member`, with exactly one `owner`, so a person has exactly one place by construction.
The model, `Organization` in [`back-end/datatypes.py`](../../back-end/datatypes.py), holds the map and derives `owner`, `admins` and `members` from it in its order; it refuses a map with no owner or more than one.

An organization stored before the map is read by one fold, `people_from_lists`: the owner gets `owner`, then each admin not yet placed `admin`, then each member not yet placed `member`, in list order.
The owner wins, so an organization that did not parse parses, and grants its people their roles again, from the moment this is deployed, before any migration runs.
Every reader of a raw document reads its people through `organization_people_of`, the stored map or the fold, and "the organizations this person is in" is one filter, `of_person` in [`back-end/organization_people.py`](../../back-end/organization_people.py), finding the person's key in the map, served by a `people.$**` wildcard index as `roles.$**` serves a market's, or, on an organization with no map, any of its three lists.

**The old lists stay on the document for one release**, written beside the map by every write.
Chosen over writing the map alone so that a rollback to the release before this one, an Instant Rollback of the back end, reads the same people this release reads, and so that the three list indexes keep serving the filter's branches for an organization with no map.

**One module writes a person's place**, `organization_people`: a table says what each change does to the target's place as read and who may ask for it, and each change is one conditional write that lands only while the requester's and the target's places still stand as read, or, on an organization with no map, while its three lists do, folding the map in; handing the organization on is one such write too, filtered on the giver being owner, so no cut and no read finds it with two owners, none, or an owner in a list.
A write that met another change stores nothing and answers a 409 the screen says and reads again on; nothing is retried, so no change lands on people other than the ones it was judged on ([the organization's people](../implementation/modules/organization-people.md)).

A user id becomes a key of the map, and a part of a dotted path, only when it comes from a stored account or from the stored map, never from request text; `organization_people` refuses an id that is not a non-empty string, or that holds a `.` or starts with `$`, as a programming error.

## Consequences

- An organization's place and a market's role read the same way: a map keyed by user id, one entry a person, exactly one owner.
- A person's organizations are found in either shape until every organization holds a map.
- **The follow-up**, a release after this one and once every stored organization holds a map: remove `owner`, `admins` and `members` from every organization document, the fold, the lists the writes keep beside the map, the filter's list branches and the three list indexes, and `User.organizations` with every write of it.
