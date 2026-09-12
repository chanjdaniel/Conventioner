---
id: E01/F03
title: Re-import
type: feature
status: done
blocked_by: [E01/F02]
pr: []
---

## Outcome

An organizer imports the same Google Form again - because it kept collecting, because a mapping was wrong, because a vendor sent a correction - and gets a sane merge instead of a duplicate-key error or a wiped review.

## Why now

Re-import is the expected case, not the exception. A form keeps collecting after the first import, so any organizer who imports early will import again.

Governed by [ticket 05](../../../wayfinding/v0-1-0/issues/05-reimport-and-identity.md).

## The constraint that shapes it

Applicant identity is a unique index on `(market_id, applicant_email, application_type)`, and that index *is* the guarantee, not a decoration on one the code keeps anyway.

`find_or_create_application` writes with `$setOnInsert`, so it **cannot update**: a re-import routed through it would silently no-op for every applicant who already exists. Re-import needs its own write path.
