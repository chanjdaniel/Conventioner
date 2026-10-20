---
id: E36/F05/S01
title: "Submitted" until results are published
type: story
status: done
blocked_by: []
pr: [#116]
---

## What to build

Until a market's results are published, the applicant's page reads "Submitted" for every application, whatever its stored status: undecided, approved, rejected by a person or a rule, or needing follow-up (decision 12).
The status is decided by the server's applicant read; the page shows what it is given and holds no mapping of its own.

## As built

- `applicant_visible_status` serves `open` always; the dashboard reads it as Submitted.

## Acceptance criteria

- [x] Before publishing, an application rejected by a rule as it was submitted reads "Submitted", the same as an undecided one.
- [x] Before publishing, approved, rejected and follow-up applications read "Submitted".
- [x] The applicant read serves nothing before publishing from which a verdict could be told (no status field, reason or giver).
- [x] One E2E spec submits an application a rule rejects, and reads "Submitted".
