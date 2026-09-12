---
id: E01/F03/S02
title: Upsert on applicant identity and report absent rows
type: story
status: done
blocked_by: [E01/F02/S02]
pr: [#59]
---

## What to build

Re-importing a file containing applicants who already exist updates them, instead of failing on the unique index.

The merge is an upsert on `(market_id, applicant_email)`, matching the index exactly. Appending is not available - the index forbids a second main application for one address. Replacing wholesale is refused deliberately: it would destroy review state and rotate application ids that the review view, and any future offer, depend on.

Applications that exist but are **absent** from the new file are left alone and counted in the preview. Absence almost always means the organizer exported a filtered or partial range, not that the applicant withdrew, and inferring withdrawal from a missing row would destroy review state on a guess.

## Acceptance criteria

- [ ] Re-importing an existing applicant updates their application rather than erroring
- [ ] A new applicant in the same file is created as normal
- [ ] Application ids are stable across a re-import
- [ ] Applications absent from the new file are untouched, and their count is stated in the preview
- [ ] The preview distinguishes new, updated, and absent before anything is written
- [ ] Updates go through the shared write path, so a re-imported document is shaped like any other
- [ ] Backend tests cover: new only, updates only, mixed, and a file whose applicants are all absent from it
- [ ] An e2e story imports, re-imports a changed file, and asserts the merge

## Notes

`find_or_create_application` writes with `$setOnInsert` and **cannot update**. Do not route this through it.

`CANCELLED` exists for a genuine withdrawal, but that is a deliberate organizer act. Do not infer it from absence.
