---
id: E04
title: v0.1.0 release
type: epic
status: proposed
blocked_by: [E01, E02, E03]
pr: []
---

## Outcome

`dev` is promoted to `main`, release-please cuts `v0.1.0`, and the documentation an organizer or operator reads matches what the product actually does.

## Why now

Nothing has ever shipped: the manifest is still `0.0.0` and there are no version tags.
The release machinery exists and is automated, so this epic is mostly about what has to be *true* before promotion, not about the promotion itself.

## Scope

- Promote `dev` to `main` and merge the resulting Release PR
- Remove `release-as: 0.1.0` from `release-please-config.json` once `v0.1.0` ships, so later versions follow conventional commits
- Bring `docs/STARTUP.md` and `docs/TESTING.md` back in step with the product after the intake and solver changes
- Delete or rewrite `docs/TODO.md`, which is a stale checklist of finished work and now contradicts this backlog
- Reconcile `AGENTS.md`: the "CSV Field Runtime Coupling" section describes a deferral that E02 resolves

Deployment, hosting, and Vercel configuration are **out of scope** - the user owns those directly.
