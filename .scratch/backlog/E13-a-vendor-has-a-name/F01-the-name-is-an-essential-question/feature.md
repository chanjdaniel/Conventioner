---
id: E13/F01
title: The name is an essential question
type: feature
status: in-progress
blocked_by: []
pr: []
---

## Outcome

`essential_full_name` exists, every form asks it, the applicant validator requires it, and the
importer offers it as a target.

## Why now

`essential_fields.py` is the single owner of the essential contract and there are exactly seven
keys, none of them a name. Adding the eighth widens what "essential" means, so it is one deliberate
change with its glossary entry already written (`CONTEXT.md`).
