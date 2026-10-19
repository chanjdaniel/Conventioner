---
id: E32/F03/S03
title: A test market of each path, for checking in production
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

The production test markets were cleared after the 2026-10-18 dry run, so a check like `S02`'s has nothing to run against.
Modify the seeding script and re-run it so production has one test market of each intake path (one taking applications online, open; one started from a Google Form), owned by a test organization, with no real applicant's details.

Settled 2026-10-19 with Daniel: a new production seeder, a back-end script beside `create_account.py`, run with the production `MONGODB_URI` passed inline, never from `back-end/.env`.

## Acceptance criteria

- [ ] Re-running the script makes both markets, and running it twice makes no duplicates.
- [ ] Neither market carries any real person's details.
- [ ] How to run it against production, without the production database address in any committed or local env file, is written in the operations runbook.
