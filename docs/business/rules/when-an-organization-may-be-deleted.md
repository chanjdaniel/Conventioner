---
layer: business
kind: rule
describes:
  - back-end/api/organizations.py#BLOCKING_PHASES
  - back-end/api/organizations.py#_market_summary
  - back-end/api/organizations.py#organization_deletion_preview
  - back-end/api/organizations.py#OrganizationHasLiveMarkets
  - back-end/api/organizations.py#delete_organization
  - back-end/api/organizations.py#_mark_deleting
  - back-end/api/organizations.py#_take_its_markets
  - back-end/api/organizations.py#_owner_asks
  - front-end/src/components/DeleteOrgDialog.vue
  - back-end/history.py#delete_for_organization
verified: 2026-11-13
sources:
  - wayfinding/the-order-of-the-work/10
  - E20/F04/S01
  - E20
  - bug/47
  - E40/F02/S01
  - T277
  - T307
---

# When an organization may be deleted

Deleting an organization deletes the drafts and archived markets it holds, with all their records, and is refused while it holds any market mid-lifecycle; the refusal names each such market.
No market is ever left belonging to nothing.

**Serves:** [The door on market day](../intents/the-door-on-market-day.md).

## Why

Deleting an organization used to set each of its markets' `organizationId` to null: a market belonging to nothing, which is a state `POST /markets` refuses to produce, and which made those markets invisible to everyone who reached them through it.
That update is **gone outright**, not kept as a fallback, since a fallback would preserve the exact state the rule exists to prevent.

A market in `applications`, `assignment`, `offers` or `market_days` has someone applying, being reviewed, being placed, or trading today; deleting it destroys work in progress, so the organizer archives or deletes it first.
A draft is a plan nobody else has seen, and an archived market is finished, so both may go.

**An archived market that ran is a record, and deleting it destroys one** ([an archived market that ran stays a record](an-archived-market-that-ran-stays-a-record.md)).
That was weighed and kept: archived markets go with their organization, taking the only record of who sat where and a vendor page that was live.
So a count of markets does not let an organizer decide: the confirmation names, per market, its name, its phase as its intake path names it (Review on a Google Form market, Applications on one whose vendors apply on its page), whether it ran, how many assignments it holds, and the public address that stops resolving.
What was deleted, by whom and when is recorded in the deletion trail before anything is destroyed, once however often the deletion is sent.
**The organization's own history goes with it**, as each market's history goes with the market: who joined it, who renamed it, which markets were created in it ([the organization document](../../implementation/data/organization-document.md#the-organizations-history)).
The deletion trail is what outlives both.

## Who may

The organization's owner, alone ([the organization document](../../implementation/data/organization-document.md)).

## Where it is kept

- **`BLOCKING_PHASES`** in [`back-end/api/organizations.py`](../../../back-end/api/organizations.py) is the partition, by phase.
  **The check lives with the organization API, NOT in `guards.py`**, whose registry is validated against the transition table and is for transitions; deleting is not one ([the guards](../../implementation/modules/guards.md)).
- `organization_deletion_preview` (`GET /organizations/:id/deletion-preview`) is read-only and the whole content of the confirmation, [`DeleteOrgDialog.vue`](../../../front-end/src/components/DeleteOrgDialog.vue); each market is summarised by `_market_summary`, which asks the [phase record](../../implementation/modules/phase-record.md) whether an archived market ran ([ADR 0012](../../adr/0012-a-market-remembers-every-phase-it-entered.md)).
- `delete_organization` reads the organization whatever its state, so a deletion cut at any step is finished by the same request sent again ([the tombstone](../../implementation/modules/market-deletion.md#the-tombstone)).
  On a live organization it judges the same preview and raises `OrganizationHasLiveMarkets` naming every blocking market and the phase as its intake path names it (a 409 [client error](../../implementation/conventions/an-exception-never-reaches-a-client.md) whose `body()` is the refusal the dialog reads); then it sets the organization's tombstone, `deleting: {at, by, trail_id}`, by one write held on its being live (`_mark_deleting`), from which moment it reads as absent and takes no write, a new market included.
  On one already deleting it asks the owner's right again (`_owner_asks`) and goes on with its tombstone's trail id.
- Unless the trail holds the deletion's entry already, `_take_its_markets` gives each live market the preview did not find blocking the same tombstone, each by one write held on its stored phase as read, then judges every market again as it now stands.
  **A market that entered a blocking phase after the preview is not deleted**: a draft's first import, which takes it into Review, lands between the preview and its tombstone, so the second judgment finds it live and under way, takes every tombstone of this trail id away again, the organization's included, and refuses, naming it.
  A market another deletion is taking (its own Delete) is not judged again, since it is going already.
- Then it writes the trail under its trail id, deletes each of its markets through [market deletion](../../implementation/modules/market-deletion.md), deletes the organization's own history (`delete_for_organization` in [`back-end/history.py`](../../../back-end/history.py)), pulls the organization from its people's lists and deletes it.
  Each step deletes what is there, so a retry cut after any of them leaves one trail entry, naming every market as it stood before any went, and nothing behind.
- `back-end/tests/test_organization_deletion.py` and `front-end/e2e/org-deletion.spec.ts` pin it; `back-end/tests/test_the_organizations_history.py` pins that the history goes and the trail is still written; `back-end/tests/real_mongo/test_a_deletion_leaves_a_tombstone.py` cuts each step on a real server and sends it again.
