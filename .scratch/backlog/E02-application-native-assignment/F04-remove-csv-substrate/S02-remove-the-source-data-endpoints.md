---
id: E02/F04/S02
title: Remove the source-data endpoints and collection
type: story
status: done
blocked_by: [E02/F04/S01]
pr: []
---

## What to build

The source-data API is gone: upload, fetch, fetch-as-CSV, list, headers, and delete, along with their routes, and the collection behind them.

Database initialisation and reset stop creating it, and the market deletion path stops trying to clean it up.

## Acceptance criteria

- [ ] All six source-data API functions and their routes are removed
- [ ] The collection is no longer created by database initialisation or reset
- [ ] Market deletion no longer references source data
- [ ] No import of the source-data module remains anywhere
- [ ] Backend tests covering the removed endpoints are deleted rather than skipped
- [ ] The full suite is green

## Notes

**This story owns a question that was explicitly deferred to it.**
The priority-rewrite decision concluded there is nothing to migrate, on the grounds that nothing has shipped and there is no deployment, and asked that this be verified against a real database rather than assumed.
It asked for the same verification of source data, at the same time.

Do both, and record what was found in the PR.
If any real data does exist, stop and raise it rather than deleting through it.
