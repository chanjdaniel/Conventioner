---
id: E04/F02/S02
title: TESTING.md describes the suites that exist, and TODO.md is gone
type: story
status: ready
blocked_by: [E04/F01/S02]
pr: []
---

## What to build

`docs/TESTING.md` describes what each suite actually covers, so a reader deciding where a new test
belongs is not misled. `docs/TODO.md` is deleted.

The specific correction that motivates this: the document says the market pipeline suite "exercises
the full product flow". It does not. It creates the market over the API and seeds applications
already approved, so it covers setup through assignment and nothing before it. The suite that does
walk the full journey is the one E04/F01/S02 adds, and this story is blocked on it so the document
is rewritten once rather than twice.

`TODO.md` is a checklist of finished work that now contradicts this backlog. It is deleted rather
than rewritten: `.scratch/backlog/` superseded it, and two competing lists are how a stale one
survives.

## Acceptance criteria

- [ ] Every suite named in the document is described by what it covers, with no claim broader than
      the spec supports
- [ ] The journey spec from E04/F01/S02 is documented, and the boundary between it and the pipeline
      and import suites is stated
- [ ] The seeding helpers section matches the helpers that exist, including which ones write a
      status directly and why a spec might not want that
- [ ] `docs/TODO.md` is deleted, and nothing in the repository still links to it
- [ ] The commands the document gives for running each suite are run and work as written
