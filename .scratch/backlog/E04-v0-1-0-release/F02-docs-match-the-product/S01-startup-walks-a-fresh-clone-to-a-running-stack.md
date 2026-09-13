---
id: E04/F02/S01
title: STARTUP.md walks a fresh clone to a running stack
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

Someone who has just cloned the repository can follow `docs/STARTUP.md` top to bottom and end with a
running stack, a user they can log in as, and a market on screen.

Verified by doing it, not by reading it: the story is not done until the steps have been followed as
written, from a clean checkout, and the result observed.

## What is known stale

- It names `source_data` as one of the back-end API modules. E02 deleted that module, its endpoints
  and its collection.
- It tells the reader to create a user by posting to `/register-user`. That endpoint does not set
  `email_verified`, so the resulting user cannot log in; the working path is the test-user script.
- It documents a CSV export directory for assignment output.
- It predates the boot requirements: a back end with no configured secrets now refuses to start, and
  the env template must be copied in **both** `back-end/` and `front-end/`.
- It predates the market-document migration, which the back end refuses to boot without.

That list is what is already known, not a scope limit. Anything else found while following the steps
is in scope.

## Acceptance criteria

- [ ] Every command in the document has been run, in order, from a clean checkout
- [ ] The document ends with the reader logged in and looking at the product, not at a stack trace
- [ ] Both env-template copies are named, and the boot requirements they satisfy are explained
      rather than listed
- [ ] The market-key migration is part of the path, not a troubleshooting footnote
- [ ] Nothing in the document references a module, endpoint or directory that no longer exists
- [ ] Where a step has a known failure mode, the document says what it looks like and what to do
