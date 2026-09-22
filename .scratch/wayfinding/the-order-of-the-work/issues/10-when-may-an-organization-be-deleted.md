# 10: What happens to a market when its organization is deleted, and when may an organization be deleted at all?

Type: grilling
Status: resolved
Blocked by: -

## Question

`delete_organization` (`back-end/api/organizations.py:138`) has exactly one precondition: the caller is the organization's **owner**.
There is no guard of any other kind.

On delete it does three things: sets `organizationId` to `None` on every market of that organization, `$pull`s the org id from every user's `organizations` array, and deletes the organization document.
Nothing is refused, nothing is confirmed beyond the modal, and nothing is recoverable.

Four consequences:

- **It manufactures a state the product refuses to create.**
  `POST /markets` rejects a payload with no `organizationId` - a market with no organization cannot be *made*, yet this makes them by the handful.
  Every reader downstream was written against an invariant this one call breaks.
- **It silently changes who can see a market.**
  `get_markets_for_user` reaches a market two ways: an explicit role on the market, or membership of its organization.
  An orphaned market keeps its explicit-role holders and loses everyone who reached it through the org - no notice, no trace.
- **A live market can be orphaned.**
  Nothing checks the phase.
  An organization holding a published market with a public check-in URL and vendors assigned for market day deletes exactly as easily as an empty one.
- **There is no undo and no record.**
  `placement_history` covers placements only; an organization's deletion is written nowhere.

### What to decide

**Two questions, genuinely separate, which should be decided together because the second may make the first moot.**

1. **What should a market do when its organization goes away?**
   Refuse the delete while markets exist; require the markets be moved to another organization first; cascade-delete them; or keep orphaning but make an orphaned market a first-class state the whole product understands - who owns it, who sees it, whether it can still be edited, how it gets re-homed.
2. **What conditions should permit deleting an organization at all?**
   Owner-only is the current answer and it is about *authority*, not *safety*.
   Should it also depend on state - no markets, no non-draft markets, no other members, an explicit typed confirmation, a grace period?

If deletion is refused while any market exists, orphaning never happens and question 1 answers itself.

### Notes

Independent of every other ticket on this map.
It is here because the walk found it, and because it is the only place in the product where one click destroys state that cannot be reconstructed.

Findings: `Q2` in `.scratch/qc/2026-09-21-manual-qc.md`.

## Answer

**Deleting an organization is refused while it holds a market that is mid-lifecycle. Drafts and archived markets are deleted with it. Orphaning stops existing.**

Owner-only stays as the authority rule; this adds the safety rule it never had.

### The partition

- **Blocks the deletion:** `applications_open`, `applications_closed`, `review`, `assignment`, `offers`, `market_days`.
  A market in any of these is in the middle of something an organizer, an applicant or a vendor is depending on.
- **Deleted with the organization:** `draft` and `archived`.

The refusal names the markets and their phases, so the organizer can act on it rather than guess.

### The risk this accepts, recorded rather than argued

`published_market_by_slug` defines *published* as `phase != draft`, so **an archived market is still publicly served**: its check-in page is live, and it holds the placement record for a market that actually ran.
CLAUDE.md records `draft -> archived` as the publish transition.
Deleting an archived market therefore takes a live check-in URL off the air and destroys the only record of who sat where, with no undo.

This was raised and the decision was reaffirmed on 2026-09-22: archived markets are deleted.
It is written here so that it reads as a choice and not an oversight, and so that anyone surprised by it later finds the reasoning rather than a bug.

Two things follow that the build owes to that choice:

- **The confirmation must name what it destroys**, per market: its name, its phase, whether it ran, how many placements it holds, and the public URL that will stop resolving. A count of markets is not enough for an irreversible action.
- **The deletion is recorded.** `placement_history` covers placements only, and an organization's deletion is currently written nowhere. A market that vanishes with its organization should leave a trail saying what happened to it and who did it.

### What stops existing

**Orphaning.**
Today `delete_organization` sets `organizationId` to `None` on every market it held, which:

- manufactures a state the product refuses to create, since `POST /markets` rejects a payload with no `organizationId`;
- silently changes who can see a market, because `get_markets_for_user` reaches markets through org membership as well as explicit roles, so everyone in the org loses access with no notice.

With this answer no market survives its organization, so neither happens.
**The `organizationId = None` update is deleted, not kept as a fallback.**
A fallback would preserve exactly the state this answer exists to prevent, and `market_from_document` and every org-scoped query would still have to tolerate it.

### Consequences

- **The refusal belongs beside the other preconditions in spirit, but not in `guards.py`.** That registry is for *phase transitions*, and `_validate_registry()` checks it against the transition table. An organization deletion is not a transition; the check lives with `delete_organization` in `back-end/api/organizations.py`, which is already the single owner of that collection.
- **The member `$pull` stays.** Removing the org from every user's `organizations` array is correct and unaffected.
- **The Manage organization dialog adopts [ticket 08](08-what-a-dialog-is-in-this-product.md)'s rules**, including that the delete confirmation - the one irreversible action here - is verified by opening it.
