---
id: E20/F04
title: Deleting an organization is safe
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

Deleting an organization cannot silently take a market out from under the people working on it, and no market is ever left belonging to nothing.

## Why now

Deleting an organization has exactly one precondition - that the caller owns it - and then sets every one of its markets to belong to no organization.

That state is one the product refuses to create through any other door, and it silently changes who can see a market: markets are reached either by an explicit role or by organization membership, so everyone who reached one through the organization loses it with no notice and no trace.
Nothing checks the phase either, so an organization holding a market that is mid-review deletes exactly as easily as an empty one.

Settled in [ticket 10](../../../wayfinding/the-order-of-the-work/issues/10-when-may-an-organization-be-deleted.md).

## The risk this feature carries, recorded rather than argued

A market that has been **archived is still publicly served** and holds the placement record of a market that actually ran.
This feature deletes archived markets along with their organization, which takes a live check-in URL off the air and destroys that record, with no undo.

This was raised during charting and the decision was reaffirmed on 2026-09-22.
It is recorded here so it reads as a choice and not an oversight, and it is why the confirmation and the trail are acceptance criteria rather than nice-to-haves.

## Stories

- `S01` - deleting an organization is safe.
