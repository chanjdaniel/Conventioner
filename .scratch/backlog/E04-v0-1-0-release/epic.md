---
id: E04
title: v0.1.0 release
type: epic
status: in-progress
blocked_by: [E01, E02, E03, E06/F01/S02]
pr: []
---

## Outcome

The MVP journey is proven walkable as one continuous organizer session, `dev` is promoted to `main`,
release-please cuts `v0.1.0`, and the documentation an organizer or operator reads matches what the
product actually does.

Deploying that tag is the user's own acceptance step and is not part of this epic.

## Why now

Nothing has ever shipped: the manifest is still `0.0.0` and there are no version tags.
The release machinery exists and is automated, so this epic is mostly about what has to be *true*
before promotion, not about the promotion itself.

E01, E02 and E03 each built and tested a slice of the journey. No test has ever walked the whole
thing, and slice coverage is exactly what missed the publishing seam bug E03 found in F02/S04.

## Scope

**Proving the journey**

- One end-to-end spec that walks create market -> set up tables -> import a CSV -> review and
  approve -> run assignment, as a single organizer session
- Bulk-approve in the application monitor, so reviewing an imported CSV is not one click per row.
  Its shape is decided by [wayfinding ticket 08](../../wayfinding/v0-1-0/issues/08-bulk-approve-shape.md)

**Documentation**

- Bring `docs/STARTUP.md` and `docs/TESTING.md` back in step with the product after the intake and
  solver changes
- Delete `docs/TODO.md`, a stale checklist of finished work that now contradicts this backlog

**Release mechanics**

- Promote `dev` to `main` and merge the resulting Release PR
- Remove `release-as: 0.1.0` from `release-please-config.json` once `v0.1.0` ships, so later
  versions follow conventional commits

## Out of scope

- Deployment, hosting, and Vercel configuration - the user owns those directly
- Seed or demo data for a fresh instance
- Any assignment export beyond the existing CSV download

## Corrections to the original scope

- The `AGENTS.md` "CSV Field Runtime Coupling" section no longer exists; E02 removed it along with
  the substrate it described. Nothing to reconcile.
