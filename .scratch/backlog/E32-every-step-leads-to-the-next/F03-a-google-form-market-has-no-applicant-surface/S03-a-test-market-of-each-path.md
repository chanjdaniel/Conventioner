---
id: E32/F03/S03
title: A test market of each path, for checking in production
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

The production test markets were cleared after the 2026-10-18 dry run, so a check like `S02`'s has nothing to run against.
Modify the seeding script and re-run it so production has one test market of each intake path (one taking applications online, open; one started from a Google Form), owned by a test organization, with no real applicant's details.

Settled 2026-10-19 with Daniel: a new production seeder, a back-end script beside `create_account.py`, run with the production `MONGODB_URI` passed inline, never from `back-end/.env`.

## As built

- `back-end/seed_test_markets.py --owner <account>` makes "Conventioner Test - Online Applications" (form) and "Conventioner Test - Google Form" (csv) in "Conventioner Test Organization", both open, dates a year out, two plain questions, no applicant.
- Every write is the product's own: create, the plan, the form, and the move, judged through `MarketsApi.take_move` - now also the transition endpoint's, so the two cannot take a move differently.
- A market found by its address is left as it stands, or finished if a failed run left it in draft; a test organization or address held by someone else is refused, naming it.
- `e2e/seed-test-markets.spec.ts` runs it twice in the back-end container from an empty start, finishes a market a failed run left in draft, visits both markets as a stranger, and applies to the online one as a vendor.
- It prints paths, not addresses: it cannot know which site the database it was given serves.
- Not yet run against production: that is the operator's, from `main` once this release is there (`docs/OPERATIONS.md`, "The test markets").

## Acceptance criteria

- [x] Re-running the script makes both markets, and running it twice makes no duplicates.
- [x] Neither market carries any real person's details.
- [x] How to run it against production, without the production database address in any committed or local env file, is written in the operations runbook.
- [ ] Run against production by the operator, from `main` once the E32 release is there.
